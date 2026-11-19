-- Each TAO has its own certificate registry and governance contract (one pair serves every TI of
-- a TAO), deployed through EBSI's Proxy Factory from the registered templates. The back-office
-- records the pair on the TAO, with the block it was deployed in, where reading its events starts.
ALTER TABLE accredited_organizations
    ADD COLUMN governance_contract text CHECK (governance_contract ~ '^0x[0-9a-fA-F]{40}$'),
    ADD COLUMN certificate_registry text CHECK (certificate_registry ~ '^0x[0-9a-fA-F]{40}$'),
    ADD COLUMN contracts_block bigint CHECK (contracts_block >= 0),
    ADD COLUMN contracts_recorded_at timestamptz,
    ADD CONSTRAINT accredited_organizations_tao_contracts CHECK (
        (governance_contract IS NULL AND certificate_registry IS NULL AND contracts_block IS NULL)
        OR (kind = 'tao' AND governance_contract IS NOT NULL AND certificate_registry IS NOT NULL
            AND contracts_block IS NOT NULL)
    );

CREATE UNIQUE INDEX accredited_organizations_governance_contract
    ON accredited_organizations (lower(governance_contract))
    WHERE governance_contract IS NOT NULL;
CREATE UNIQUE INDEX accredited_organizations_certificate_registry
    ON accredited_organizations (lower(certificate_registry))
    WHERE certificate_registry IS NOT NULL;
