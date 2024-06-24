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

exports.hub = process.env.testnet ? 'testnet.obyte.org/bb' : 'obyte.org/bb';
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

exports.buffer_base_aa = '6UZ3XA5M6B6ZL5YSBLTIDCCVAQGSYYWR';
exports.buffer_base_aas = ['VXY4L4NGFQ773NOQKUFFVJEWLZUBCYHI', '6UZ3XA5M6B6ZL5YSBLTIDCCVAQGSYYWR'];
exports.curve_base_aas = [
	'FCFYMFIOGS363RLDLEWIDBIIBU7M7BHP', '3RNNDX57C36E76JLG2KAQSIASAYVGAYG', // v1
	'3DGWRKKWWSC6SV4ZQDWEHYFRYB4TGPKX', 'CD5DNSVS6ENG5UYILRPJPHAB3YXKA63W', 'GWQVOQDPT4L5XPMDIQF5MNDQZNV5VGLY' // v2
];
exports.arb_base_aas = ['7DTJZNB3MHSBVI72CKXRIKONJYBV7I2Z', 'WQBLYBRAMJVXDWS7BGTUNUTW2STO6LYP'];
exports.carburetor_base_aa = 'CUIR3XUBUBX7ORQ7NP23M3GCNQQC46ID';

exports.governance_base_aas = [
	'Y4VBXMROK5BWBKSYYAMUW7QUEZFXYBCF', 'UUPBIWDWQ7Q4WXS5CWSEKUQE34FG6L55', // v1
	'JL6OOEOQCJ2RJ3NHCUJLUBDR3ZE3GY3F', 'LXHUYEV6IHBCTGMFNSWRBBU7DGR3JTIY' // v2
];
exports.deposit_base_aa = 'GEZGVY4T3LK6N4NJAKNHNQIVAI5OYHPC';

// v2
exports.stable_base_aas = ['YXPLX6Q3HBBSH2K5HLYM45W7P7HFSEIN'];
exports.sf_base_aas = ['5WOTEURNL2XGGKD2FGM5HEES4NKVCBCR'];
exports.de_base_aas = ['QXHLP4MLXSWHJGD3WUBFTXQSIA2R3QFG', 'R3WZUWKTFISJ53MGAGSS5OIVMDAFC3WV', '625UKTER5WR5JQPQYS7CU4ST2EXFUCDG'];

exports.factory_aas = [
	'B7RBGEW7FEASSWNTOQSDQXIKG56EJAFP', 'SAG5CJZAUSEYOEFN7FJTC23F5ZGNUR37', // v1
	'CX56T625MQDCRCQTJGYZYYWUAMCEZT2Q', 'YSVSAICPH5XOZPZL5UVH56MVHQKMXZCM', '3RU3GWMVVI7DT4ITFDRMGB7UEI3L4Y6J' // v2
];

exports.token_registry_aa = "O6H6ZIFI57X3PLTYHOCVYPP5A553CYFQ";

exports.webPort = process.env.testnet ? 8081 : 8080;
exports.wsPort = process.env.testnet ? 8091 : 8090;

exports.cryptoCoinProCheckoutUrl = process.env.testnet ? 'https://dev-checkout.infra.cryptocoin.pro' : 'https://checkout.cryptocoin.pro';

exports.MAX_STATE_CONNECTIONS = 1000;

exports.welcomeBytesAmount = 1e5;
exports.simpleswapApiKey = '';

exports.target_fee = 1; // 1%: we compensate to reduce the final fee to this value
exports.max_compensation = 10; // 10%: we never compensate more
exports.daily_compensation_quota = 10; // GB

console.log('finished buffer conf');
