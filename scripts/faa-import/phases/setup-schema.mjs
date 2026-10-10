// Phase 1: Create custom objects and fields in Twenty CRM.

import { createLogger } from '../lib/logger.mjs';
import { loadProgress, saveProgress } from '../lib/state.mjs';
import * as twenty from '../lib/twenty.mjs';
import { AIRCRAFT_FIELDS, COMPANY_CUSTOM_FIELDS, PERSON_CUSTOM_FIELDS } from '../config.mjs';

const log = createLogger('schema');

async function ensureCustomFields(objectName, fields) {
  const obj = await twenty.getObjectByName(objectName);
  if (!obj) {
    log.error(`Standard object "${objectName}" not found in Twenty`);
    return;
  }

  const existingFields = await twenty.listFields(obj.id);
  const existing = new Set();
  const fieldsList = existingFields?.data?.fields || existingFields?.data || existingFields?.fields || [];
  for (const f of fieldsList) {
    existing.add(f.name);
  }

  for (const field of fields) {
    if (existing.has(field.name)) {
      log.info(`Field "${field.name}" already exists on ${objectName}, skipping`);
      continue;
    }

    try {
      await twenty.createField({
        objectMetadataId: obj.id,
        name: field.name,
        label: field.label,
        type: field.type,
        description: `FAA Import: ${field.label}`,
      });
      log.ok(`Created field "${field.name}" on ${objectName}`);
    } catch (err) {
      // Field might already exist under a different casing — treat as non-fatal
      log.warn(`Could not create field "${field.name}" on ${objectName}: ${err.message}`);
    }
  }
}

async function ensureAircraftObject() {
  let obj = await twenty.getObjectByName('aircraft');

  if (!obj) {
    log.info('Creating Aircraft custom object...');
    try {
      obj = await twenty.createObject({
        nameSingular: 'aircraft',
        namePlural: 'aircrafts',
        labelSingular: 'Aircraft',
        labelPlural: 'Aircraft',
        description: 'FAA registered aircraft with owner relations and pricing data',
        icon: 'IconPlane',
      });
      log.ok('Created Aircraft custom object');
    } catch (err) {
      log.error(`Failed to create Aircraft object: ${err.message}`);
      throw err;
    }
  } else {
    log.info('Aircraft object already exists');
  }

  const objId = obj?.data?.id || obj?.id;
  if (!objId) {
    log.error('Could not determine Aircraft object ID');
    return;
  }

  // Add fields
  const existingFields = await twenty.listFields(objId);
  const existing = new Set();
  const fieldsList = existingFields?.data?.fields || existingFields?.data || existingFields?.fields || [];
  for (const f of fieldsList) {
    existing.add(f.name);
  }

  for (const field of AIRCRAFT_FIELDS) {
    if (existing.has(field.name)) {
      log.info(`Field "${field.name}" already exists on Aircraft, skipping`);
      continue;
    }

    try {
      await twenty.createField({
        objectMetadataId: objId,
        name: field.name,
        label: field.label,
        type: field.type,
        description: `FAA Import: ${field.label}`,
      });
      log.ok(`Created field "${field.name}" on Aircraft`);
    } catch (err) {
      log.warn(`Could not create field "${field.name}" on Aircraft: ${err.message}`);
    }
  }

  // Create relations to Company and Person
  const companyObj = await twenty.getObjectByName('company');
  const personObj = await twenty.getObjectByName('person');

  if (companyObj && !existing.has('ownerCompanyId')) {
    try {
      await twenty.createRelation({
        relationType: 'MANY_TO_ONE',
        fromObjectMetadataId: objId,
        fromLabel: 'Owner Company',
        fromName: 'ownerCompany',
        fromIcon: 'IconBuildingSkyscraper',
        toObjectMetadataId: companyObj?.data?.id || companyObj?.id,
        toLabel: 'Aircraft',
        toName: 'aircraft',
        toIcon: 'IconPlane',
      });
      log.ok('Created Aircraft → Company relation');
    } catch (err) {
      log.warn(`Could not create Company relation: ${err.message}`);
    }
  }

  if (personObj && !existing.has('ownerPersonId')) {
    try {
      await twenty.createRelation({
        relationType: 'MANY_TO_ONE',
        fromObjectMetadataId: objId,
        fromLabel: 'Owner Person',
        fromName: 'ownerPerson',
        fromIcon: 'IconUser',
        toObjectMetadataId: personObj?.data?.id || personObj?.id,
        toLabel: 'Aircraft',
        toName: 'aircraft',
        toIcon: 'IconPlane',
      });
      log.ok('Created Aircraft → Person relation');
    } catch (err) {
      log.warn(`Could not create Person relation: ${err.message}`);
    }
  }
}

export async function run() {
  const progress = loadProgress();
  if (progress.schema.completed) {
    log.info('Schema setup already completed, skipping');
    return;
  }

  log.info('Setting up custom fields and objects in Twenty CRM...');

  // Test connection first
  const test = await twenty.testConnection();
  if (!test.ok) {
    log.error(`Cannot connect to Twenty CRM: ${test.error}`);
    throw new Error('Twenty API connection failed');
  }
  log.ok('Connected to Twenty CRM');

  // Add custom fields to Company
  log.info('Adding custom fields to Company...');
  await ensureCustomFields('company', COMPANY_CUSTOM_FIELDS);

  // Add custom fields to Person
  log.info('Adding custom fields to Person...');
  await ensureCustomFields('person', PERSON_CUSTOM_FIELDS);

  // Create Aircraft custom object
  log.info('Setting up Aircraft custom object...');
  await ensureAircraftObject();

  progress.schema.completed = true;
  progress.currentPhase = 'companies';
  saveProgress();

  log.ok('Schema setup complete');
}
