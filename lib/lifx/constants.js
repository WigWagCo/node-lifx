'use strict';

module.exports = {
  // Ports used by LIFX
  LIFX_DEFAULT_PORT: 56700,
  LIFX_ANY_PORT: 56800,

  // Masks for packet description in packet header
  ADDRESSABLE_BIT: 0x1000,
  TAGGED_BIT: 0x2000,
  ORIGIN_BITS: 0xC000,
  PROTOCOL_VERSION_BITS: 0xFFF,

  // Masks for response types in packet header
  RESPONSE_REQUIRED_BIT: 0x1,
  ACK_REQUIRED_BIT: 0x2,

  // Protocol version mappings
  PROTOCOL_VERSION_CURRENT: 1024,
  PROTOCOL_VERSION_1: 1024,

  MESSAGE_RATE_LIMIT: 50, // in ms
  DISCOVERY_INTERVAL: 5000, // in ms

  // Packet defaults
  DEFAULT_TIMEOUT: 1000,
  DEFAULT_RETRIES: 0,
  // Packet headers
  PACKET_HEADER_SIZE: 36,

  // HSBK value calculation
  HSBK_MINIMUM_KELVIN: 2500,
  HSBK_DEFAULT_KELVIN: 3500,
  HSBK_MAXIMUM_KELVIN: 9000,
  HSBK_MINIMUM_BRIGHTNESS: 0,
  HSBK_MAXIMUM_BRIGHTNESS: 100,
  HSBK_MINIMUM_SATURATION: 0,
  HSBK_MAXIMUM_SATURATION: 100,
  HSBK_MINIMUM_HUE: 0,
  HSBK_MAXIMUM_HUE: 360,

  // Vendor ID values
  LIFX_VENDOR_IDS: [
    {id: 1, name: 'LIFX'}
  ],

  // Product ID values
  LIFX_PRODUCT_IDS: [
    {id: 1, name: 'The Original'},
    {id: 2, name: 'Color 650'},
    {id: 3, name: 'White 800'}
  ]
};
