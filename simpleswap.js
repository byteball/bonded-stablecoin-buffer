const fetch = require('node-fetch');
const conf = require('ocore/conf.js');

const URL = 'https://api.simpleswap.io/v1';


const request = (endpoint, options) => {
	return fetch(`${URL}${endpoint}`, {
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
		},
		...options
	})
}

const createExchange = async (amount, currency_from, address_to) => {
	const params = {
		amount,
		currency_from,
		currency_to: 'GBYTE',
		address_to,
	};
	const response = await request(`/create_exchange?api_key=${conf.simpleswapApiKey}`, {
		body: JSON.stringify(params),
		method: 'POST'
	})

	if (!response.ok) {
		const error = await response.text()
		console.error('-- error', error)
		throw new Error(error)
	}

	const data = await response.json()
	return data
}

const fetchExchangeInfo = async (id) => {
	const response = await request(`/get_exchange?api_key=${conf.simpleswapApiKey}&id=${id}`)

	console.error(JSON.stringify(response, null, 2))
	console.error('ok', response.ok)

	if (!response.ok) {
		const error = await response.text()
		console.error('-- error', error)
		throw new Error(error)
	}

	const data = await response.json()
	return data
}

async function test() {
	const data = await fetchExchangeInfo('9k1X8LFp31');
//	const data = await createExchange(.005, 'BTC', 'EV4PGZDEWC572QD3EJ5DE4GDTC56UI2L');
	console.log(data);
}
//test();

exports.createExchange = createExchange;
exports.fetchExchangeInfo = fetchExchangeInfo;
