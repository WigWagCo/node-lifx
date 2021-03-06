'use strict';

var Lifx = require('../../').Client;
var Light = require('../../').Light;
var packet = require('../../').packet;
var assert = require('chai').assert;
var sinon = require('sinon');

suite('Client', () => {
  let client;

  beforeEach(() => {
    client = new Lifx();
  });

  afterEach(() => {
    client.destroy();
  });

  test('not connected by default', () => {
    assert.isNull(client.address());
  });

  test('connected after init', (done) => {
    client.init({}, () => {
      assert.isObject(client.address());
      assert.property(client.address(), 'address');
      assert.property(client.address(), 'port');
      done();
    });
  });

  test('accepts init parameters', (done) => {
    client.init({
      address: '127.0.0.1',
      port: 57500,
      source: '12345678',
      lightOfflineTolerance: 2,
      messageHandlerTimeout: 12000
    }, () => {
      assert.equal(client.address().address, '127.0.0.1');
      assert.equal(client.address().port, 57500);
      assert.equal(client.source, '12345678');
      assert.equal(client.lightOfflineTolerance, 2);
      assert.equal(client.messageHandlerTimeout, 12000);
      done();
    });
  });

  test('init parameters of wrong types throw exception', () => {
    assert.throw(() => {
      client.init({port: '57500'});
    }, TypeError);

    assert.throw(() => {
      client.init({source: 23456789});
    }, TypeError);

    assert.throw(() => {
      client.init({lightOfflineTolerance: '3'});
    }, TypeError);

    assert.throw(() => {
      client.init({messageHandlerTimeout: '30000'});
    }, TypeError);
  });

  test('inits with random source by default', (done) => {
    client.init({
      startDiscovery: false
    }, () => {
      assert.typeOf(client.source, 'string');
      assert.lengthOf(client.source, 8);
      done();
    });
  });

  test('discovery start and stop', (done) => {
    client.init({
      startDiscovery: false
    }, () => {
      assert.isNull(client.discoveryTimer);
      client.startDiscovery();
      assert.isObject(client.discoveryTimer);
      client.stopDiscovery();
      assert.isNull(client.discoveryTimer);
      done();
    });
  });

  test('finding bulbs by different parameters', () => {
    const bulbs = [];
    let bulb;

    bulb = new Light({
      client: client,
      id: '0dd124d25597',
      address: '192.168.0.8',
      port: 56700,
      seenOnDiscovery: 1
    });
    bulb.status = 'off';
    bulbs.push(bulb);

    bulb = new Light({
      client: client,
      id: 'ad227d95517z',
      address: '192.168.254.254',
      port: 56700,
      seenOnDiscovery: 1
    });
    bulbs.push(bulb);

    bulb = new Light({
      client: client,
      id: '783rbc67cg14',
      address: '192.168.1.5',
      port: 56700,
      seenOnDiscovery: 2
    });
    bulbs.push(bulb);

    bulb = new Light({
      client: client,
      id: '883rbd67cg15',
      address: 'FE80::903A:1C1A:E802:11E4',
      port: 56700,
      seenOnDiscovery: 2
    });
    bulbs.push(bulb);

    client.devices = bulbs;

    let result;
    result = client.light('0dd124d25597');
    assert.instanceOf(result, Light);
    assert.equal(result.address, '192.168.0.8');

    result = client.light('FE80::903A:1C1A:E802:11E4');
    assert.instanceOf(result, Light);
    assert.equal(result.id, '883rbd67cg15');

    result = client.light('192.168.254.254');
    assert.instanceOf(result, Light);
    assert.equal(result.id, 'ad227d95517z');

    result = client.light('141svsdvsdv1');
    assert.isFalse(result);

    result = client.light('192.168.0.1');
    assert.isFalse(result);

    assert.throw(() => {
      client.light({id: '0123456789012'});
    }, TypeError);

    assert.throw(() => {
      client.light(['12a135r25t24']);
    }, TypeError);
  });

  test('package sending', (done) => {
    client.init({
      startDiscovery: false
    }, () => {
      assert.lengthOf(client.messagesQueue, 0, 'is empty');
      client.send(packet.create('getService', {}, '12345678'));
      assert.lengthOf(client.messagesQueue, 1);
      assert.property(client.messagesQueue[0], 'data');
      assert.notProperty(client.messagesQueue[0], 'address');
      done();
    });
  });

  test('getting all known lights', () => {
    const bulbs = [];
    let bulb;

    bulb = new Light({
      client: client,
      id: '0dd124d25597',
      address: '192.168.0.8',
      port: 56700,
      seenOnDiscovery: 1
    });
    bulbs.push(bulb);

    bulb = new Light({
      client: client,
      id: '783rbc67cg14',
      address: '192.168.0.9',
      port: 56700,
      seenOnDiscovery: 1
    });
    bulb.status = 'off';
    bulbs.push(bulb);

    client.devices = bulbs;
    assert.deepEqual(client.lights(''), bulbs);

    assert.deepEqual(client.lights(), [bulbs[0]]);
    assert.deepEqual(client.lights('on'), [bulbs[0]]);

    assert.deepEqual(client.lights('off'), [bulbs[1]]);
  });

  suite('message handler', () => {
    beforeEach(function() {
      this.clock = sinon.useFakeTimers();
    });

    afterEach(function() {
      this.clock.restore();
    });

    test('discovery handler registered by default', () => {
      assert.lengthOf(client.messageHandlers, 1);
      assert.equal(client.messageHandlers[0].type, 'stateService');
    });

    test('adding valid handlers', () => {
      const prevMsgHandlerCount = client.messageHandlers.length;
      client.addMessageHandler('stateLight', () => {}, 1);
      assert.lengthOf(client.messageHandlers, prevMsgHandlerCount + 1, 'message handler has been added');
      assert.equal(client.messageHandlers[1].type, 'stateLight', 'correct handler type');
      assert.equal(client.messageHandlers[1].timestamp / 1000, Date.now() / 1000, 'timestamp set to now');
    });

    test('adding invalid handlers', () => {
      assert.throw(() => {
        client.addMessageHandler('stateLight', () => {}, '1');
      }, TypeError);
    });

    test('calling and removing one time handlers after call', (done) => {
      let mustBeFalse = false;
      const prevMsgHandlerCount = client.messageHandlers.length;

      client.addMessageHandler('temporaryHandler', () => {
        mustBeFalse = true; // Was falsely triggered
      }, 2);
      client.addMessageHandler('temporaryHandler2', () => {
        mustBeFalse = true; // Was falsely triggered
      }, 1);
      client.addMessageHandler('temporaryHandler', (err, msg, rinfo) => {
        assert.isNull(err, 'no error');
        assert.isObject(msg);
        assert.isObject(rinfo);
        assert.lengthOf(client.messageHandlers, prevMsgHandlerCount + 2, 'this handler has been removed');
        assert.equal(mustBeFalse, false, 'incorrect handlers not called');
        done();
      }, 1);
      assert.lengthOf(client.messageHandlers, prevMsgHandlerCount + 3, 'handler has been added');

      // emit a fake message, rinfo is not relevant for fake
      client.processMessageHandlers({
        type: 'temporaryHandler',
        sequence: 1
      }, {});
    });

    test('keeping permanent handlers after call', (done) => {
      const prevMsgHandlerCount = client.messageHandlers.length;
      client.addMessageHandler('permanentHandler', (err, msg, rinfo) => {
        assert.isNull(err, 'no error');
        assert.isObject(msg);
        assert.isObject(rinfo);
        done(); // Make sure callback is called
      });
      assert.lengthOf(client.messageHandlers, prevMsgHandlerCount + 1, 'handler has been added');

      // emit a fake message, rinfo is not relevant for fake
      client.processMessageHandlers({type: 'permanentHandler'}, {});

      assert.lengthOf(client.messageHandlers, prevMsgHandlerCount + 1, 'handler is still present');
    });

    test('calling and removing packets with sequenceNumber, after messageHandlerTimeout', function(done) {
      const prevMsgHandlerCount = client.messageHandlers.length;
      const messageHandlerTimeout = 30000; // Our timeout for the test

      client.init({
        startDiscovery: false,
        messageHandlerTimeout: messageHandlerTimeout
      }, () => {
        client.addMessageHandler('temporaryHandler', (err, msg, rinfo) => {
          assert.instanceOf(err, Error, 'error was thrown');
          assert.isNull(msg);
          assert.isNull(rinfo);
          assert.lengthOf(client.messageHandlers, prevMsgHandlerCount, 'handler should be removed after timeout');
          done();
        }, 2);
        assert.lengthOf(client.messageHandlers, prevMsgHandlerCount + 1, 'handler has been added');

        // Instant
        client.processMessageHandlers({type: 'someRandomHandler'}, {});
        assert.lengthOf(client.messageHandlers, prevMsgHandlerCount + 1, 'handler should still exist after instant call');

        // Short before messageHandlerTimeout
        setTimeout(() => {
          client.processMessageHandlers({type: 'someRandomHandler'}, {});
          assert.lengthOf(client.messageHandlers, prevMsgHandlerCount + 1, 'handler should still exist before timeout');
        }, messageHandlerTimeout - 1);

        // Directly after messageHandlerTimeout
        setTimeout(() => {
          // This will trigger the message handler callback
          client.processMessageHandlers({type: 'someRandomHandler'}, {});
        }, messageHandlerTimeout + 1);

        this.clock.tick(messageHandlerTimeout - 1);
        this.clock.tick(messageHandlerTimeout + 1);
      });
    });
  });

  test('changing debugging mode', () => {
    assert.equal(client.debug, false, 'debug off by default');

    client.setDebug(true);
    assert.equal(client.debug, true);

    client.setDebug(false);
    assert.equal(client.debug, false);
  });
});
