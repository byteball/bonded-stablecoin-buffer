CREATE TABLE buffer_addresses (
	buffer_address CHAR(32) NOT NULL PRIMARY KEY,
	address CHAR(32) NOT NULL,
	curve_aa CHAR(32) NOT NULL,
	definition TEXT NOT NULL,
	in_work TINYINT NOT NULL DEFAULT 1,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	last_update_date TIMESTAMP NULL
);
-- query separator
CREATE INDEX byInWork ON buffer_addresses(in_work);
-- query separator
CREATE UNIQUE INDEX byAddrCurve ON buffer_addresses(address, curve_aa);
-- query separator

CREATE TABLE orders (
	order_id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
	provider VARCHAR(32) NOT NULL,
	provider_id VARCHAR(64) NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	provider_status VARCHAR(20) NULL,
	buffer_address CHAR(32) NOT NULL,
	amount_in DECIMAL(20, 9) NOT NULL,
	currency_in VARCHAR(15) NOT NULL,
	expected_amount_out DECIMAL(20, 9) NOT NULL,
	expected_fee DECIMAL(13, 9) NOT NULL,
	expected_compensation DECIMAL(20, 9) NULL,
	amount_out DECIMAL(20, 9) NULL,
	fee DECIMAL(13, 9) NULL,
	compensation DECIMAL(20, 9) NULL,
	is_done TINYINT NOT NULL DEFAULT 0,
	is_eligible TINYINT NOT NULL DEFAULT 0, -- eligible for compensation of swap fees
	is_compensated TINYINT NOT NULL DEFAULT 0,
	compensation_unit CHAR(44) NULL,
	compensation_date TIMESTAMP NULL,
	FOREIGN KEY (buffer_address) REFERENCES buffer_addresses(buffer_address)
);
-- query separator
CREATE UNIQUE INDEX byProviderId ON orders(provider, provider_id);
-- query separator
CREATE INDEX byBufferAddress ON orders(buffer_address);
-- query separator
CREATE INDEX byCreationDate ON orders(creation_date);
-- query separator
CREATE INDEX byEligibleDoneCompensated ON orders(is_eligible, is_done, is_compensated);
