# Autonomous Agent for buying T2 tokens through a buffer

This AA helps to buy T2 tokens while keeping the fee below 1% (or another configured threshold). The funds in the reserve currency are sent to this AA, a bot checks the current state of the curve and triggers this AA to buy a specific number of T2 tokens from the curve. Several purchases might be required in order to convert the entire deposited amount into T2 as each purchase has to be small enough in order not to move the price too much and not to pay large fees. The purchased T2 tokens are sent directly to the user's address.

A new AA is created for each user and manages the funds of this single user.

This buffer AA is used to allow users to buy T2 tokens in one step by paying in non-Obyte cryptocurrencies (BTC, ETH, USDT, etc) on the [Buy interest tokens](https://ostable.org/buy) page on ostable.org. A new buffer AA is created for the user, his input currency is converted to GBYTE using a swapping service such as simpleswap.io, the output GBYTE is sent to the buffer AA, then a bot triggers the AA (possibly, several times) to convert the deposited GBYTEs to T2 tokens and send them to the user.

Anybody can trigger the AA to execute a purchase of T2 tokens. A companion bot is included here that watches the transactions happening on the curve, estimates their effects, calculates the amount of T2 tokens that can be bought without paying a fee that would exceed 1%, and triggers the AA.

The bot can also send some additional GBYTEs to the AA to compensate the user for the fees charged by the swapping service. These additional GBYTEs are also converted to T2.

## Installing
```bash
yarn
```

## Testing the AA

Tests are written using the [AA Testkit](https://github.com/valyakin/aa-testkit).

```bash
yarn test
```

## Running the bot

```bash
node run.js 2>errlog
```
If it complains about missing tables, create them:
```bash
node db_import.js
```

The bot listens on port 8080 (8081 for testnet) and serves as backend for the [Buy interest tokens](https://ostable.org/buy) page on ostable.org.

It serves the following endpoints:
* GET `/api/create_buffer`: create a new buffer AA for a user, parameters: `address` - user address where they want to receive T2 tokens, `curve_aa` - address of the curve AA they are buying from.
* GET `/api/get_expected_compensation`: get an estimation of the compensation for a simpleswap exchange of amount `amount_in` in input currency `currency_in` to `amount_out` GBYTE.
* POST `/api/create_order`: record a newly created exchange order. Parameters: `buffer_address` and the properties of the simpleswap order.
