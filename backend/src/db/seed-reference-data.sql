-- Reference data seed, exported from the live Supabase project 2026-08-04.
--
-- federations / divisions / weight_classes are hand-maintained in the dashboard
-- and had NO source in this repo, which meant no environment -- local, CI, or a
-- fresh RDS instance -- could be stood up without them. Profile creation
-- validates against these three tables, so without this seed every
-- POST /users/profile for an athlete fails.
--
-- Applied after the migration chain:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f src/db/seed-reference-data.sql
--
-- Idempotent: re-running updates in place rather than duplicating.


-- federations: 3 rows
insert into federations (id, code, name) values
  ('2339e288-bd79-4d91-b357-e5f5969a5223', 'IPF', 'International Powerlifting Federation'),
  ('6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'USAPL', 'USA Powerlifting'),
  ('cc2b4e30-6a01-4951-9c32-549cb668c2f9', 'PA', 'Powerlifting America')
on conflict (id) do update set
  code = excluded.code,
  name = excluded.name;

-- divisions: 16 rows
insert into divisions (id, federation_id, name, minimum_age, maximum_age) values
  ('26dcbca5-07aa-48e5-b944-32f28036fa65', '2339e288-bd79-4d91-b357-e5f5969a5223', 'Sub-Junior', 14, 18),
  ('6109ea57-ca0e-40d2-8a0d-73260ca80159', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Master 4', 70, 80),
  ('78c1c48b-b7ca-4827-8232-dba3f8c69d2d', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Teen 2', 16, 18),
  ('8146ddee-566c-48c9-93ea-a81101c04353', '2339e288-bd79-4d91-b357-e5f5969a5223', 'Junior', 19, 23),
  ('82572ed1-2384-4692-9c99-4fc1533285f9', '2339e288-bd79-4d91-b357-e5f5969a5223', 'Master 1', 40, 49),
  ('90171fc8-5b8a-4fb2-aea9-9fab4646e147', '2339e288-bd79-4d91-b357-e5f5969a5223', 'Master 3', 60, 69),
  ('a8da983e-3f7c-4070-affe-578b8f4db5fe', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Junior', 20, 24),
  ('abc4b9ef-7aae-41dd-9694-2a3091ba5184', '2339e288-bd79-4d91-b357-e5f5969a5223', 'Open', 19, null),
  ('b02a63fa-927a-4423-90c6-99c9d4367305', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Master 2', 50, 60),
  ('c087b26e-a30e-45b5-8b03-dc48e21f6878', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Master 3', 60, 70),
  ('d4a8b6e3-6982-4528-ba04-827b442a1ffe', '2339e288-bd79-4d91-b357-e5f5969a5223', 'Master 4', 70, 79),
  ('df815b80-dcc5-431f-acc1-c48a557f0173', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Open', 14, null),
  ('e9330de6-ff52-437a-86c9-57aa43860172', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Teen 3', 18, 20),
  ('ef23db11-8068-4c5e-be3a-b431665d029a', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Master 1', 40, 50),
  ('f3dd0034-8fe7-486c-8c47-a75c448e9888', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Teen 1', 14, 16),
  ('f96b8897-3f0e-4a0e-b709-8cce84c94c39', '2339e288-bd79-4d91-b357-e5f5969a5223', 'Master 2', 50, 59)
on conflict (id) do update set
  federation_id = excluded.federation_id,
  name = excluded.name,
  minimum_age = excluded.minimum_age,
  maximum_age = excluded.maximum_age;

-- weight_classes: 40 rows
insert into weight_classes (id, federation_id, gender, name, min_weight, max_weight, sort_order, active) values
  ('03f81e5f-0b05-49f9-a41f-37389aee875d', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Female', '60kg', 56.01, 60, 5, true),
  ('0d6486a7-be03-4bc0-98f8-b34921241a79', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Male', '56kg', 52.01, 56, 2, true),
  ('1a0f4eed-2654-4f1e-9a16-f13ea8eac13d', '2339e288-bd79-4d91-b357-e5f5969a5223', 'Male', '105kg', 93.01, 105, 6, true),
  ('1acdd910-ea3e-4a44-b5dc-833c93bf9328', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Male', '60kg', 56.01, 60, 3, true),
  ('1fcc786f-9588-4d18-8bf0-a5564157c9b0', '2339e288-bd79-4d91-b357-e5f5969a5223', 'Male', '93kg', 83.01, 93, 5, true),
  ('2402b0d5-5437-4d3e-868b-c5e9a7d7540b', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Male', '110kg', 100.01, 110, 9, true),
  ('2611422a-a039-4355-a51b-4a1625332944', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Female', '90kg', 82.51, 90, 10, true),
  ('2c70f371-286d-47a9-87f7-47209efa2ca8', '2339e288-bd79-4d91-b357-e5f5969a5223', 'Female', '63kg', 57.01, 63, 4, true),
  ('2f4fbd28-79cd-4f90-8e18-855f420ebdb3', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Female', '70kg', 65.01, 70, 7, true),
  ('30571e61-9c6e-4ed6-97a9-af7e732aec18', '2339e288-bd79-4d91-b357-e5f5969a5223', 'Female', '76kg', 69.01, 76, 6, true),
  ('31b64628-2f64-4e4a-bce8-aed8a1837d7b', '2339e288-bd79-4d91-b357-e5f5969a5223', 'Male', '59kg', null, 59, 1, true),
  ('34b917c7-7ddb-43c0-922b-753910433f36', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Male', '75kg', 67.51, 75, 5, true),
  ('3a68cecd-ae82-4a50-bdab-232a01252765', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Female', '75kg', 70.01, 75, 8, true),
  ('3e49a245-f24a-4709-a1ab-03bfeb866a63', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Male', '90kg', 82.51, 90, 7, true),
  ('5328639b-bf21-49b0-8f0d-f4e166697d88', '2339e288-bd79-4d91-b357-e5f5969a5223', 'Female', '69kg', 63.01, 69, 5, true),
  ('60d2b1fa-f71c-45dc-b496-e397457b3aec', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Male', '100kg', 90.01, 100, 8, true),
  ('6b460d4c-5954-4a20-8889-449a4ae443db', '2339e288-bd79-4d91-b357-e5f5969a5223', 'Female', '52kg', 47.01, 52, 2, true),
  ('6d2651f5-6753-49fa-bfb5-259e55ff67b8', '2339e288-bd79-4d91-b357-e5f5969a5223', 'Female', '57kg', 52.01, 57, 3, true),
  ('72aecb63-b625-483d-8122-05415cf2a5fe', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Male', '52kg', null, 52, 1, true),
  ('7c8f734e-8f68-413e-809b-500849ace761', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Female', '65kg', 60.01, 65, 6, true),
  ('84da4907-26cf-4e7b-865a-5672ad73074e', '2339e288-bd79-4d91-b357-e5f5969a5223', 'Male', '74kg', 66.01, 74, 3, true),
  ('8775269a-8e12-4742-8a5d-18d39d5375ed', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Female', '44kg', null, 44, 1, true),
  ('8c9b40fc-cba6-40a2-b935-52a38583dc18', '2339e288-bd79-4d91-b357-e5f5969a5223', 'Male', '120kg+', 120.01, null, 8, true),
  ('8d5eec37-1a6c-49c3-a4e1-6922bb2fb0c5', '2339e288-bd79-4d91-b357-e5f5969a5223', 'Female', '84kg+', 84.01, null, 8, true),
  ('91773b9a-0ca7-4f11-9b3b-36b0ccfc23ad', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Female', '56kg', 52.01, 56, 4, true),
  ('9891ef9d-2cae-4549-a0fe-062947fe7eee', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Male', '82.5kg', 75.01, 82.5, 6, true),
  ('9a81f8a8-931d-4121-b89d-139471848726', '2339e288-bd79-4d91-b357-e5f5969a5223', 'Male', '83kg', 74.01, 83, 4, true),
  ('bf6a4d6c-c18c-4df0-93df-1eeb9606f9e2', '2339e288-bd79-4d91-b357-e5f5969a5223', 'Male', '120kg', 105.01, 120, 7, true),
  ('caff8953-623d-476d-96e8-979940669c13', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Female', '100kg', 90.01, 100, 11, true),
  ('cdb39476-a535-40e0-9815-f2a85ab57028', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Female', '100kg+', 100.01, null, 12, true),
  ('d2f9a339-00c7-486e-b600-dc22950d8c44', '2339e288-bd79-4d91-b357-e5f5969a5223', 'Male', '66kg', 59.01, 66, 2, true),
  ('d7627788-d0a4-4b5e-b6e6-e6ec76601b0e', '2339e288-bd79-4d91-b357-e5f5969a5223', 'Female', '47kg', null, 47, 1, true),
  ('d84b1866-88c8-4d7f-9bf9-55bbabedb298', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Female', '48kg', 44.01, 48, 2, true),
  ('e0386e27-6eb1-4420-904d-95d5a72b1f4d', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Female', '82.5kg', 75.01, 82.5, 9, true),
  ('e131fef7-3575-418e-bf64-eb48832d4c77', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Male', '67.5kg', 60.01, 67.5, 4, true),
  ('e2e24ce7-23b9-40ca-87e2-0b00f4dcda9a', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Male', '140kg+', 140.01, null, 12, true),
  ('f1c9e6cc-0c38-4300-b75a-f7e3e3f31914', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Male', '125kg', 110.01, 125, 10, true),
  ('f5aedbef-9e1b-45a6-914c-6e1059a8e21a', '2339e288-bd79-4d91-b357-e5f5969a5223', 'Female', '84kg', 76.01, 84, 7, true),
  ('fe68ab99-6c65-4a24-a316-e3ccda69ca31', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Female', '52kg', 48.01, 52, 3, true),
  ('ff41aebd-f862-4d46-aa7e-dc650c1829ba', '6dd4a324-f5f0-4d62-a3e8-52aae276ea50', 'Male', '140kg', 125.01, 140, 11, true)
on conflict (id) do update set
  federation_id = excluded.federation_id,
  gender = excluded.gender,
  name = excluded.name,
  min_weight = excluded.min_weight,
  max_weight = excluded.max_weight,
  sort_order = excluded.sort_order,
  active = excluded.active;
