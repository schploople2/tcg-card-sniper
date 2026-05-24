-- A2: new AlertKind value for mis-titled lot alerts.
-- See docs/features/2bp-mistitled-detector.md.
ALTER TYPE "AlertKind" ADD VALUE 'MISTITLED';
