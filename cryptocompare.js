const fetch = require('node-fetch');

const URL = 'https://min-api.cryptocompare.com';


const request = (endpoint, options) => {
	return fetch(`${URL}${endpoint}`, {
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
		},
		...options
	})
}

const fetchExchangeRate = async (in_currency) => {
	const response = await request(`/data/price?fsym=${in_currency}&tsyms=GBYTE`)

	console.error(JSON.stringify(response, null, 2))
	console.error('ok', response.ok)

	if (!response.ok) {
		const error = await response.text()
		console.error('-- error', error)
		throw new Error(error)
	}

	const data = await response.json()
	if (!data.GBYTE)
		throw new Error(`no GBYTE in response ${data}`);
	return data.GBYTE
}

async function test() {
	const rate = await fetchExchangeRate('BTC');
	console.log(rate);
}
//test();

exports.fetchExchangeRate = fetchExchangeRate;
