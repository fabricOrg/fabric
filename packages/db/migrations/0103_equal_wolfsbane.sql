ALTER TABLE "accounts" ALTER COLUMN "data_region" SET DEFAULT 'eu-west-1';
UPDATE "accounts" SET "data_region" = 'eu-west-1' WHERE "data_region" = 'af-south-1';
