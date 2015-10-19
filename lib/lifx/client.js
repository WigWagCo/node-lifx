'use strict';

var util = require('util');
var dgram = require('dgram');
var EventEmitter = require('eventemitter3');
var _ = require('lodash');
var Packet = require('../lifx').packet;
var Light = require('../lifx').Light;
var constants = require('../lifx').constants;
var utils = require('../lifx').utils;


function AckEntry(opts) {
  this.retryRemain = 0;
  this.timeout = 0;
  if(opts && typeof opts === 'object') {
    if(opts.retryRemain) this.retryRemain = opts.retryRemain;
    this.callback = opts.callback;
    this.timeout = opts.timeout;    
  }
}

/**
 * Creates a lifx client
 * @extends EventEmitter
 */
function Client() {
  EventEmitter.call(this);

  this.debug = false;
  this.socket = dgram.createSocket('udp4');
  this.devices = {};
  this.port = null;
  this.messagesQueue = [];
  this.sendTimer = null;
  this.discoveryTimer = null;
  this.discoveryPacketSequence = 0;
  this.messageHandlers = [{
    type: 'stateService',
    callback: this.processDiscoveryPacket.bind(this)
  }];
  this.ackTable = {};
  this.sequenceNumber = 0;
  this.lightOfflineTolerance = 3;
  this.messageHandlerTimeout = 45000; // 45 sec
  this.source = utils.getRandomHexString(8);
}
util.inherits(Client, EventEmitter);

/**
 * Creates a new socket and starts discovery
 * @example
 * init({debug: true}, function() {
 *   console.log('Client started');
 * })
 * @param {Object} [options] Configuration to use
 * @param {String} [options.address] The IPv4 address to bind to
 * @param {Number} [options.port] The port to bind to
 * @param {Boolean} [options.debug] Show debug output
 * @param {Number} [options.lightOfflineTolerance] If light hasn't answered for amount of discoveries it is set offline
 * @param {Number} [options.messageHandlerTimeout] Message handlers not called will be removed after this delay in ms
 * @param {String} [options.source] The source to send to light, must be 8 chars lowercase or digit
 * @param {Boolean} [options.startDiscovery] Weather to start discovery after initialization or not
 * @param {Function} [callback] Called after initialation
 */
Client.prototype.init = function(options, callback) {
  var defaults = {
    address: '0.0.0.0',
    port: constants.LIFX_DEFAULT_PORT,
    debug: false,
    lightOfflineTolerance: 3,
    messageHandlerTimeout: 45000,
    source: '',
    startDiscovery: true,
    discoveryInterval: constants.DISCOVERY_INTERVAL
  };

  options = options || {};
  var opts = _.defaults(options, defaults);

  this.discoveryInterval = opts.discoveryInterval;

  if (typeof opts.port !== 'number') {
    throw new TypeError('LIFX port option must be a number');
  }

  if (typeof opts.debug !== 'boolean') {
    throw new TypeError('LIFX debug option must be a boolean');
  }
  this.debug = opts.debug;

  if (typeof opts.lightOfflineTolerance !== 'number') {
    throw new TypeError('LIFX lightOfflineTolerance option must be a number');
  }
  this.lightOfflineTolerance = opts.lightOfflineTolerance;

  if (typeof opts.messageHandlerTimeout !== 'number') {
    throw new TypeError('LIFX messageHandlerTimeout option must be a number');
  }
  this.messageHandlerTimeout = opts.messageHandlerTimeout;

  if (opts.source !== '') {
    if (typeof opts.source === 'string') {
      if (/^[0-9A-F]{8}$/.test(opts.source)) {
        this.source = opts.source;
      } else {
        throw new RangeError('LIFX source option must be 8 hex chars');
      }
    } else {
      throw new TypeError('LIFX source option must be given as string');
    }
  }

  this.socket.on('error', function(err) {
    console.error('LIFX UDP packet error');
    console.trace(err);
    this.emit('error', err);
  }.bind(this));

  this.socket.on('message', function(msg, rinfo) {
    // Ignore own messages and false formats
    if (utils.getHostIPs().indexOf(rinfo.address) >= 0 || !Buffer.isBuffer(msg)) {
      return;
    }

    if (this.debug) {
      console.log('D - ' + msg.toString('hex') + ' < ' + rinfo.address);
    }
    // Parse packet to object
    msg = Packet.toObject(msg);

    // Convert type before emitting
    var messageTypeName = _.result(_.find(Packet.typeList, {id: msg.type}), 'name');
    if (messageTypeName !== undefined) {
      msg.type = messageTypeName;
    }

    // Check for handlers of given message and rinfo
    if(!this.processMessageHandlers(msg, rinfo)) {
      if(!this.processAckTable(msg,rinfo)) {
        this.emit('message', msg, rinfo);      
      }
    } else {
      this.emit('message', msg, rinfo);      
    }

  }.bind(this));

  var send_now = false;
  this.startSend = function() {
    send_now = true; // dummy function, until full bind() below happens
  }

  this.socket.bind(opts.port, opts.address, function() {
    this.socket.setBroadcast(true);
    this.emit('listening');
    this.port = opts.port;
    this.packetPump = function() {
      if (this.messagesQueue.length > 0) {
        var msg = this.messagesQueue.pop();
        if (msg.address === undefined) {
          msg.address = '255.255.255.255';
        }
        this.socket.send(msg.data, 0, msg.data.length, this.port, msg.address);
        if(msg.onSent) 
          msg.onSent();
        if (this.debug) {
          console.log('D - ' + msg.data.toString('hex') + ' > ' + msg.address + (msg.ackRequired ? (" want ACK ("+msg.sequence+")")  : ""));
        }
      } else {
        if(this.sendTimer) {
          if (this.debug) console.log("STOP packetPump");
          clearInterval(this.sendTimer);
          this.sendTimer = null;          
        }
      }
    }.bind(this);

    this.startSend = function() {
      if(!this.sendTimer) {
        this.packetPump();
        if(this.debug) console.log("START packetPump");
        this.sendTimer = setInterval(this.packetPump, constants.MESSAGE_RATE_LIMIT);
      }
    }
    if(send_now) this.startSend();
    this.sendTimer = null;
    // this.sendTimer = setInterval(this.packetPump, constants.MESSAGE_RATE_LIMIT);
    if (typeof callback === 'function') {
      return callback();
    }
  }.bind(this));

  // Start scanning
  if (opts.startDiscovery) {
    this.startDiscovery();
  }
};

/**
 * Destroy an instance
 */
Client.prototype.destroy = function() {
  this.socket.close();
};

/**
 * Start discovery of lights
 * This will keep the list of lights updated, finds new lights and sets lights
 * offline if no longer found
 */
Client.prototype.startDiscovery = function() {
  var sendDiscoveryPacket = function() {
    // Sign flag on inactive lights
    _.forEach(this.devices, function(info, address) {
      if (this.devices[address].status !== 'off') {
        var diff = this.discoveryPacketSequence - info.seenOnDiscovery;
        if (diff >= this.lightOfflineTolerance) {
          this.devices[address].status = 'off';
          this.emit('bulb-offline', info); // deprecated
          this.emit('light-offline', info);
        }
      }
    }, this);

    // Send the discovery packet broadcast
    this.send(Packet.create('getService', {}, this.source));

    // Keep track of a sequent number to find not answering lights
    if (this.discoveryPacketSequence >= Number.MAX_VALUE) {
      this.discoveryPacketSequence = 0;
    } else {
      this.discoveryPacketSequence += 1;
    }
    this.emit('discovery-packet-sent',this.discoveryPacketSequence);
  }.bind(this);

  this.discoveryTimer = setInterval(
    sendDiscoveryPacket,
    this.discoveryInterval
//    constants.DISCOVERY_INTERVAL
  );

  sendDiscoveryPacket();
};

/**
 * Checks all registered message handlers if they request the given message
 * @param  {Object} msg message to check handler for
 * @param  {Object} rinfo rinfo address info to check handler for
 * @return {Boolean} Returns true if handler needed the packet
 */
Client.prototype.processMessageHandlers = function(msg, rinfo) {
  // We check our message handler if the answer received is requested
  var ret = false;
  this.messageHandlers.forEach(function(handler, index) {
    if (msg.type === handler.type) {
      if (handler.sequenceNumber !== undefined) {
        if (handler.sequenceNumber === msg.sequence) {
          // Remove if specific packet was request, since it should only be called once
          this.messageHandlers.splice(index, 1);

          // Call the function requesting the packet
          handler.callback(null, msg, rinfo);
          ret = true;
        }
      } else {
        // Call the function requesting the packet
        handler.callback(null, msg, rinfo);
        ret = true;
      }
    }

    // We want to call expired request handlers for specific packages after the
    // messageHandlerTimeout set in options, to specify an error
    if (handler.sequenceNumber !== undefined) {
      if (Date.now() > (handler.timestamp + this.messageHandlerTimeout)) {
        this.messageHandlers.splice(index, 1);

        var err = new Error('No LIFX response in time');
        handler.callback(err, null, null);
      }
    }
  }, this);
  return ret;
};

/**
 * Processes a discovery report packet to update internals
 * @param  {Object} err Error if existant
 * @param  {Object} msg The discovery report package
 * @param  {Object} rinfo Remote host details
 */
Client.prototype.processDiscoveryPacket = function(err, msg, rinfo) {
  if (err) {
    return;
  }
  if (msg.service === 'udp' && msg.port === constants.LIFX_DEFAULT_PORT) {
    // Add / update the found gateway
    if (!this.devices[rinfo.address]) {
      var lightDevice = new Light({
        client: this,
        id: msg.target,
        address: rinfo.address,
        port: msg.port,
        seenOnDiscovery: this.discoveryPacketSequence
      });
      this.devices[rinfo.address] = lightDevice;
      this.emit('bulb-new', lightDevice); // deprecated
      this.emit('light-new', lightDevice);
    } else {
      if (this.devices[rinfo.address].status === 'off') {
        this.devices[rinfo.address].status = 'on';
        this.emit('bulb-online', this.devices[rinfo.address]); // deprecated
        this.emit('light-online', this.devices[rinfo.address]);
      }
      this.devices[rinfo.address].seenOnDiscovery = this.discoveryPacketSequence;
    }
  }
};

/**
 * This stops the discovery process
 * The client will be no longer updating the state of lights or find lights
 */
Client.prototype.stopDiscovery = function() {
  clearInterval(this.discoveryTimer);
  this.discoveryTimer = null;
};

/**
 * Send a LIFX message objects over the network
 * @param  {Object} msg A message object or multiple with data to send
 * @param  {Object} [opts] An optional options object
 * @return {Number} The sequence number of the request
 */
Client.prototype.send = function(msg,opts) {
  var packet = {};

  // Add the target ip address if target given
  if (msg.target !== undefined) {
    var targetBulb = this.light(msg.target);
    if (targetBulb) {
      packet.address = targetBulb.address;
      if (this.sequenceNumber > 254) {
        this.sequenceNumber = 1;
      } else {
        this.sequenceNumber += 1;
      }
    }
  }

  if(opts && typeof opts.callback === 'function') {
    packet.ackRequired = msg.ackRequired = true;
  }

  packet.sequence = msg.sequence = this.sequenceNumber;
  packet.data = Packet.toBuffer(msg);

  if(opts && typeof opts === 'object' && typeof opts.callback === 'function') {
    var myopts = {
      timeout: constants.DEFAULT_TIMEOUT,
      retryRemain: constants.DEFAULT_RETIES,
      callback: opts.callback
    };
    if(opts.timeout !== undefined) myopts.timeout = opts.timeout;
    if(opts.retries !== undefined) myopts.retryRemain = opts.retries;
    var entry = new AckEntry(myopts);
    entry.packet = packet;
    this.ackTable[this.sequenceNumber] = entry;

    var timeoutHandler = function(seq){
      if(this.ackTable[seq] === undefined) {
        if(this.debug) console.log("Lost entry in ackTable. ignoring.");
        return;
      }
      if(this.debug) console.log("TIMEOUT on ack, seq: " + seq);
      if(this.ackTable[seq].retryRemain < 1) {
        if(typeof this.ackTable[seq].callback === 'function')
          this.ackTable[seq].callback.call(undefined,new Error('timeout'),seq,this);
        delete this.ackTable[seq];
      } else {
        this.ackTable[seq].retryRemain--;
        if(this.debug) console.log("RETRY on seq: " + seq + " remain: " + this.ackTable[seq].retryRemain);
        setTimeout(timeoutHandler,this.ackTable[seq].timeout);
        this.messagesQueue.unshift(this.ackTable[seq].packet);
        this.startSend();
      }
    }.bind(this,this.sequenceNumber); 

    entry.onAck = function(seq){
      clearTimeout(this.ackTable[seq].timer);
      if(this.debug) console.log("Got ACK on seq: " + seq);
      if(typeof this.ackTable[seq].callback === 'function') {
        this.ackTable[seq].callback.call(undefined,undefined,seq,this);
      }
      delete this.ackTable[seq];
    }.bind(this,this.sequenceNumber);

    packet.onSent = function(seq,handler) {
      if(this.debug) console.log("Timer on seq " + seq + " " + myopts.timeout);
      this.ackTable[seq].timer = setTimeout(handler,myopts.timeout);  // start the timer when the packet is really sent...
    }.bind(this,this.sequenceNumber,timeoutHandler);
    
  }

  this.messagesQueue.unshift(packet);
  this.startSend();

  return this.sequenceNumber;
};


/**
 * Runs through the ackTable, calling callbacks and clearing timers for packets sent
 * which wanted an ACK.
 * @param  {Object} msg message to check handler for
 * @param  {Object} rinfo rinfo address info to check handler for
 * @return {[type]} returns true if the Client was waiting on an Ack
 */
Client.prototype.processAckTable = function(msg, rinfo) {
  var entry = this.ackTable[msg.sequence];
  if(entry) {
    if(this.debug) console.log("FOUND ACK ENTRY FOR " + msg.sequence);
    entry.onAck();
    return true;
  } else
    return false;
}

/**
 * Get network address data from connection
 * @return {Object} Network address data
 */
Client.prototype.address = function() {
  var address = null;
  try {
    address = this.socket.address();
  } catch (e) {}
  return address;
};

/**
 * Sets debug on or off at runtime
 * @param  {boolean} debug debug messages on
 */
Client.prototype.setDebug = function(debug) {
  if (typeof debug !== 'boolean') {
    throw new TypeError('Lifx Client setDebug expects boolean as parameter');
  }
  this.debug = debug;
};

/**
 * Adds a message handler that calls a function when the requested
 * info was received
 * @param {String} type A type of packet to listen for, like stateLight
 * @param {Function} callback the function to call if the packet was received,
 *                   this will be called with parameters msg and rinfo
 * @param {Number} [sequenceNumber] Expects a specific sequenceNumber on which will
 *                                  be called, this will call it only once. If not
 *                                  given the callback handler is permanent
 */
Client.prototype.addMessageHandler = function(type, callback, sequenceNumber) {
  var handler = {
    type: type,
    callback: callback.bind(this),
    timestamp: Date.now()
  };

  if (sequenceNumber !== undefined) {
    if (typeof sequenceNumber !== 'number') {
      throw new TypeError('Lifx Client.addMessageHandler expects sequenceNumber to be a integer');
    } else {
      handler.sequenceNumber = sequenceNumber;
    }
  }

  this.messageHandlers.push(handler);
};

/**
 * Returns the list of all known lights
 * @param {String} [status='on'] Status to filter for, empty string for all
 * @return {Array} Lights
 */
Client.prototype.lights = function(status) {
  if (status === undefined) {
    status = 'on';
  } else if (typeof status !== 'string') {
    throw new TypeError('Lifx Client.lights expects status to be a string');
  }

  if (status.length > 0) {
    if (status !== 'on' && status !== 'off') {
      throw new TypeError('Lifx Client.lights expects status to be \'on\', \'off\' or \'\'');
    }

    var result = [];
    _.forEach(this.devices, function(light) {
      if (light.status === status) {
        result.push(light);
      }
    });
    return result;
  }

  return this.devices;
};

/**
 * Find a light by id or ip
 * @param {String} identifier id or ip to search for
 * @return {Object|Boolean} the light object or false if not found
 */
Client.prototype.light = function(identifier) {
  if (typeof identifier !== 'string') {
    throw new TypeError('light expects identifier for LIFX light to be a string');
  }
  // There is no ip or id longer than that
  if (identifier.length > 45) {
    return false;
  }
  // Id does not contain dots or colons but ip
  if (identifier.indexOf('.') >= 0 || identifier.indexOf(':') >= 0) {
    return _.find(this.devices, {address: identifier}) || false;
  }

  return _.find(this.devices, {id: identifier}) || false;
};

exports.Client = Client;
