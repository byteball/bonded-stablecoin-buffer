/*jslint node: true */
"use strict";

//exports.port = 6611;
//exports.myUrl = 'wss://mydomain.com/bb';

// for local testing
//exports.WS_PROTOCOL === 'ws://';
//exports.port = 16611;
//exports.myUrl = 'ws://127.0.0.1:' + exports.port;

exports.bServeAsHub = false;
exports.bLight = true;

exports.storage = 'sqlite';

exports.hub = process.env.testnet ? 'obyte.org/bb-test' : 'obyte.org/bb';
exports.deviceName = 'Buy bonded stablecoin bot';
exports.permanent_pairing_secret = '*';
exports.control_addresses = ['DEVICE ALLOWED TO CHAT'];
exports.payout_address = 'WHERE THE MONEY CAN BE SENT TO';
exports.bSingleAddress = true;
exports.bWantNewPeers = true;
exports.KEYS_FILENAME = 'keys.json';

// TOR
exports.socksHost = '127.0.0.1';
exports.socksPort = 9050;

exports.bNoPassphrase = false;

exports.explicitStart = true;

exports.buffer_base_aa = 'VXY4L4NGFQ773NOQKUFFVJEWLZUBCYHI';
exports.curve_base_aa = 'FCFYMFIOGS363RLDLEWIDBIIBU7M7BHP';
exports.arb_base_aa = '7DTJZNB3MHSBVI72CKXRIKONJYBV7I2Z';

exports.webPort = process.env.testnet ? 8081 : 8080;

exports.welcomeBytesAmount = 1e5;
exports.simpleswapApiKey = '';

exports.target_fee = 1; // 1%: we compensate to reduce the final fee to this value
exports.max_compensation = 5; // 5%: we never compensate more
exports.daily_compensation_quota = 10; // GB

console.log('finished buffer conf');
