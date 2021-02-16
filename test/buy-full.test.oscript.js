// uses `aa-testkit` testing framework for AA tests. Docs can be found here `https://github.com/valyakin/aa-testkit`
// `mocha` standard functions and `expect` from `chai` are available globally
// `Testkit`, `Network`, `Nodes` and `Utils` from `aa-testkit` are available globally too
const path = require('path')
const { expect } = require('chai');

function round(n, precision) {
	return Math.round(n * 10 ** precision) / 10 ** precision;
}

describe('Buy T2 through a buffer AA using one executions and get the remaining bytes', function () {
	this.timeout(120000)


	before(async () => {
		this.network = await Network.create()
			.with.numberOfWitnesses(1)
			.with.agent({ bank: path.join(__dirname, '../node_modules/bank-aa/bank.oscript') })
			.with.agent({ bs: path.join(__dirname, '../node_modules/bonded-stablecoin/bonded-stablecoin.oscript') })
			.with.agent({ bsf: path.join(__dirname, '../node_modules/bonded-stablecoin/bonded-stablecoin-factory.oscript') })
			.with.agent({ daf2: path.join(__dirname, '../node_modules/bonded-stablecoin/define-asset2-forwarder.oscript') })
			.with.agent({ governance: path.join(__dirname, '../node_modules/bonded-stablecoin/governance.oscript') })
			.with.agent({ deposits: path.join(__dirname, '../node_modules/bonded-stablecoin/deposits.oscript') })
			.with.agent({ buffer_base: path.join(__dirname, '../buffer.oscript') })
			.with.wallet({ oracle: 1e6 })
			.with.wallet({ alice: 10000e9 })
			.with.wallet({ bob: 1000e9 })
		//	.with.explorer()
			.run()
		console.log('--- agents\n', this.network.agent)
	//	console.log('--- wallets\n', this.network.wallet)
		this.oracle = this.network.wallet.oracle
		this.oracleAddress = await this.oracle.getAddress()
		this.alice = this.network.wallet.alice
		this.aliceAddress = await this.alice.getAddress()
		this.bob = this.network.wallet.bob
		this.bobAddress = await this.bob.getAddress()
	//	this.explorer = await this.network.newObyteExplorer().ready()
		
		const balance = await this.bob.getBalance()
		console.log(balance)
		expect(balance.base.stable).to.be.equal(1000e9)
	})

	it('Post data feed', async () => {
		const price = 20
		const { unit, error } = await this.oracle.sendMulti({
			messages: [{
				app: 'data_feed',
				payload: {
					GBYTE_USD: price,
				}
			}],
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { unitObj } = await this.oracle.getUnitInfo({ unit: unit })
		const dfMessage = unitObj.messages.find(m => m.app === 'data_feed')
		expect(dfMessage.payload.GBYTE_USD).to.be.equal(20)
		await this.network.witnessUntilStable(unit)

		this.price = price
	})
	
	it('Bob defines a new stablecoin', async () => {
		const { error: tf_error } = await this.network.timefreeze()
		expect(tf_error).to.be.null

		this.ts = Math.round(Date.now() / 1000)
		this.fee_multiplier = 5
		this.interest_rate = 0.1
		const { unit, error } = await this.bob.triggerAaWithData({
			toAddress: this.network.agent.bsf,
			amount: 15000,
			data: {
				reserve_asset: 'base',
				reserve_asset_decimals: 9,
				decimals1: 9,
				decimals2: 2,
				m: 2,
				n: 0.5,
				interest_rate: this.interest_rate,
				allow_grants: true,
				oracle1: this.oracleAddress,
				feed_name1: 'GBYTE_USD',
			},
		})
		console.log(unit, error)

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.bob, unit)
	//	const { response } = await this.network.getAaResponseToUnit(unit)
	//	await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		const { vars } = await this.bob.readAAStateVars(this.network.agent.bsf)
		console.log('vars', vars)
		expect(Object.keys(vars).length).to.be.equal(6)
		for (let name in vars) {
			if (name.startsWith('curve_')) {
				this.curve_aa = name.substr(6)
				expect(vars[name]).to.be.equal("s1^2 s2^0.5")
			}
		}
		this.asset1 = vars['asset_' + this.curve_aa + '_1'];
		this.asset2 = vars['asset_' + this.curve_aa + '_2'];
		this.asset_stable = vars['asset_' + this.curve_aa + '_stable'];
		this.deposit_aa = vars['deposit_aa_' + this.curve_aa];
		this.governance_aa = vars['governance_aa_' + this.curve_aa];

		const { vars: curve_vars } = await this.bob.readAAStateVars(this.curve_aa)
		console.log('curve vars', curve_vars, this.curve_aa)
		expect(curve_vars['asset1']).to.be.equal(this.asset1)
		expect(curve_vars['asset2']).to.be.equal(this.asset2)
		expect(curve_vars['governance_aa']).to.be.equal(this.governance_aa)
		expect(curve_vars['growth_factor']).to.be.equal(1)
		expect(curve_vars['dilution_factor']).to.be.equal(1)
		expect(curve_vars['interest_rate']).to.be.equal(0.1)
		expect(parseInt(curve_vars['rate_update_ts'])).to.be.eq(this.ts)

		this.getReserve = (s1, s2) => Math.ceil(1e9*(s1/1e9)**2 * (s2/1e2)**0.5)
		this.getP2 = (s1, s2) => (s1/1e9)**2 * 0.5 / (s2/1e2)**0.5
		this.getFee = (avg_reserve, old_distance, new_distance) => Math.ceil(avg_reserve * (new_distance**2 - old_distance**2) * this.fee_multiplier);

		this.buy = (tokens1, tokens2, bNoUpdate) => {
			const new_supply1 = this.supply1 + tokens1
			const new_supply2 = this.supply2 + tokens2
			const new_reserve = this.getReserve(new_supply1, new_supply2)
			const amount = new_reserve - this.reserve
			const abs_reserve_delta = Math.abs(amount)
			const avg_reserve = (this.reserve + new_reserve)/2
			const p2 = this.getP2(new_supply1, new_supply2)
	
			const old_distance = this.reserve ? Math.abs(this.p2 - this.target_p2) / this.target_p2 : 0
			const new_distance = Math.abs(p2 - this.target_p2) / this.target_p2
			let fee = this.getFee(avg_reserve, old_distance, new_distance);
			if (fee > 0) {
				const reverse_reward = Math.floor((1 - old_distance / new_distance) * this.fast_capacity); // rough approximation
			}

			const fee_percent = round(fee / abs_reserve_delta * 100, 4)
			const reward = old_distance ? Math.floor((1 - new_distance / old_distance) * this.fast_capacity) : 0;
			const reward_percent = round(reward / abs_reserve_delta * 100, 4)

			console.log('p2 =', p2, 'target p2 =', this.target_p2, 'amount =', amount, 'fee =', fee, 'reward =', reward, 'old distance =', old_distance, 'new distance =', new_distance, 'fast capacity =', this.fast_capacity)
	
			if (fee > 0 && reward > 0)
				throw Error("both fee and reward are positive");
			if (fee < 0 && reward < 0)
				throw Error("both fee and reward are negative");
	
			if (!bNoUpdate) {
				this.p2 = p2
				this.distance = new_distance
				if (fee > 0) {
					this.slow_capacity += Math.floor(fee / 2)
					this.fast_capacity += fee - Math.floor(fee / 2)
				}
				else if (reward > 0)
					this.fast_capacity -= reward
			
				this.supply1 += tokens1
				this.supply2 += tokens2
				this.reserve += amount
			}
	
			return { amount, fee, fee_percent, reward, reward_percent }
		}

		this.supply1 = 0
		this.supply2 = 0
		this.reserve = 0
		this.slow_capacity = 0
		this.fast_capacity = 0
		this.distance = 0
	})


	it('Alice buys tokens', async () => {
		this.target_p2 = 1/this.price
		const tokens1 = 1e9
		const tokens2 = 100e2
		const { amount, fee, fee_percent } = this.buy(tokens1, tokens2)

		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.curve_aa,
			amount: amount + 1000,
			data: {
				tokens1: tokens1,
				tokens2: tokens2,
			},
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
	//	await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		const { vars } = await this.alice.readAAStateVars(this.curve_aa)
		console.log(vars)
		expect(vars['supply1']).to.be.equal(this.supply1)
		expect(vars['supply2']).to.be.equal(this.supply2)
		expect(vars['reserve']).to.be.equal(this.reserve)
		expect(parseFloat(parseFloat(vars['p2']).toPrecision(13))).to.be.equal(this.p2)
		expect(vars['slow_capacity']).to.be.undefined
		expect(vars['fast_capacity']).to.be.undefined
		expect(vars['lost_peg_ts']).to.be.undefined

		const { unitObj } = await this.alice.getUnitInfo({ unit: response.response_unit })
	//	console.log(JSON.stringify(unitObj, null, '\t'))
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([
			{
				address: this.aliceAddress,
				asset: this.asset1,
				amount: tokens1,
			},
			{
				address: this.aliceAddress,
				asset: this.asset2,
				amount: tokens2,
			},
		])

	})


	it('Bob deploys buffer agent', async () => {
		const agent = {
			base_aa: this.network.agent.buffer_base,
			params: {
				address: this.aliceAddress,
				curve_aa: this.curve_aa,
				max_fee_percent: 1.5,
			}
		}
		  
		const { address, unit, error } = await this.bob.deployAgent(agent)
		expect(error).to.be.null
		expect(unit).to.be.validUnit
		expect(address).to.be.validAddress

		this.buffer_aa = address
	})

	it('Bob sends bytes to buffer agent, the amount is only slightly more than needed', async () => {
		this.target_p2 = 1/this.price
		const tokens1 = 0
		const tokens2 = .5e2
		const { amount, fee, fee_percent } = this.buy(tokens1, tokens2, true)

		this.buffer_amount = amount + fee + 5000;
		const { unit, error } = await this.bob.sendBytes({
			toAddress: this.buffer_aa,
			amount: this.buffer_amount,
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
	//	await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.null

		const { vars } = await this.bob.readAAStateVars(this.buffer_aa)
		expect(Object.keys(vars).length).to.be.eq(0)
	})


	it('Bob triggers execution', async () => {
		this.target_p2 = 1/this.price
		const tokens1 = 0
		const tokens2 = .5e2
		const { amount, fee, fee_percent } = this.buy(tokens1, tokens2)

		const net_buffer_amount = this.buffer_amount + 1e4 - 866 - (3 + 32)
		const remaining_buffer_amount = net_buffer_amount - amount - fee - 1000

		const { unit, error } = await this.bob.triggerAaWithData({
			toAddress: this.buffer_aa,
			amount: 1e4,
			data: {
				execute: 1,
				tokens2: tokens2,
				ref: this.bobAddress,
			},
			spend_unconfirmed: 'all',
		})

		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
	//	await this.network.witnessUntilStable(response.response_unit)

		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		const { vars } = await this.bob.readAAStateVars(this.buffer_aa)
		expect(Object.keys(vars).length).to.be.eq(0)

		const { unitObj } = await this.bob.getUnitInfo({ unit: response.response_unit })
	//	console.log(JSON.stringify(unitObj, null, '\t'))
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([{
			address: this.curve_aa,
			amount: net_buffer_amount,
		}])
		expect(unitObj.messages.find(m => m.app === 'data').payload).to.deep.equal({
			tokens2_to: this.aliceAddress,
			max_fee_percent: '1.5',
			tokens2,
			ref: this.bobAddress,
		})

		// response of the curve AA
		const { response: response2 } = await this.network.getAaResponseToUnit(response.response_unit)
		expect(response2.response.error).to.be.undefined
		expect(response2.bounced).to.be.false
		expect(response2.response_unit).to.be.validUnit

		const { vars: cvars } = await this.bob.readAAStateVars(this.curve_aa)
		console.log(cvars)
		expect(cvars['supply2']).to.be.equal(this.supply2)
		expect(cvars['reserve']).to.be.equal(this.reserve)
		expect(round(cvars['p2'], 13)).to.be.equal(round(this.p2, 13))
		expect(cvars['slow_capacity']).to.be.equal(this.slow_capacity)
		expect(cvars['fast_capacity']).to.be.equal(this.fast_capacity)

		const { unitObj: unitObj2 } = await this.bob.getUnitInfo({ unit: response2.response_unit })
	//	console.log(JSON.stringify(unitObj, null, '\t'))
		expect(Utils.getExternalPayments(unitObj2)).to.deep.equalInAnyOrder([
			{
				address: this.buffer_aa,
				amount: remaining_buffer_amount,
			},
			{
				asset: this.asset2,
				address: this.aliceAddress,
				amount: tokens2,
			},
		])

		// second response of the buffer AA
		const { response: response3 } = await this.network.getAaResponseToUnit(response2.response_unit)
		expect(response3.response.error).to.be.undefined
		expect(response3.bounced).to.be.false
		expect(response3.response_unit).to.be.validUnit
		expect(response3.response.responseVars.message).to.be.eq("Done")

		const { unitObj: unitObj3 } = await this.bob.getUnitInfo({ unit: response3.response_unit })
	//	console.log(JSON.stringify(unitObj, null, '\t'))
		expect(Utils.getExternalPayments(unitObj3)).to.deep.equalInAnyOrder([
			{
				address: this.aliceAddress,
				amount: remaining_buffer_amount - unitObj3.headers_commission - unitObj3.payload_commission,
			},
		])

	})



	after(async () => {
		await this.network.stop()
	})
})
