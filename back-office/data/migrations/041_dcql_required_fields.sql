-- A DCQL claim set is met only by a credential holding every claim in it. The default flow's
-- set of all fifteen includes the schema's two optional fields (jobPosition, funding), so a
-- licence issued without either could share only the four claims a verifier needs. A middle set
-- of every field the schema requires lets such a holder share all the licence holds.
UPDATE presentation_definitions
SET dcql_query = jsonb_set(
    dcql_query,
    '{credentials,0,claim_sets}',
    jsonb_build_array(
        dcql_query #> '{credentials,0,claim_sets,0}',
        '["certificateTitle","holderName","certificateNumber","certificationBody","trainingName","trainingStart","trainingEnd","trainingDays","teachingHours","knowledgeStandard","placeOfIssue","issueDate","signatory"]'::jsonb,
        dcql_query #> '{credentials,0,claim_sets,1}'
    )
)
WHERE definition_id = 'plr-cybersecurity-manager'
  AND jsonb_array_length(dcql_query #> '{credentials,0,claim_sets}') = 2;
