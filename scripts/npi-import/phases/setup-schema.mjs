// Phase 1: Create custom objects, fields, and relations in Twenty CRM.

import { createLogger } from '../lib/logger.mjs';
import { loadProgress, saveProgress } from '../lib/state.mjs';
import * as twenty from '../lib/twenty.mjs';
import {
  FACILITY_OBJECT, FACILITY_FIELDS,
  QUALITY_OBJECT, QUALITY_FIELDS,
  AFFILIATION_OBJECT, AFFILIATION_FIELDS,
  PERSON_CUSTOM_FIELDS,
} from '../config.mjs';

const log = createLogger('schema');

async function getFieldsForObject(objId) {
  const existingFields = await twenty.listFields(objId);
  const fieldsList = existingFields?.data?.fields || existingFields?.data || existingFields?.fields || [];
  const existing = new Set();
  for (const f of fieldsList) {
    if (!f.objectMetadataId || f.objectMetadataId === objId) {
      existing.add(f.name);
    }
  }
  return existing;
}

async function ensureCustomFields(objId, objectLabel, fields) {
  const existing = await getFieldsForObject(objId);

  for (const field of fields) {
    if (existing.has(field.name)) {
      log.info(`  Field "${field.name}" already exists on ${objectLabel}, skipping`);
      continue;
    }

    try {
      await twenty.createField({
        objectMetadataId: objId,
        name: field.name,
        label: field.label,
        type: field.type,
        description: `NPI Import: ${field.label}`,
      });
      log.ok(`  Created field "${field.name}" on ${objectLabel}`);
    } catch (err) {
      log.warn(`  Could not create field "${field.name}" on ${objectLabel}: ${err.message.slice(0, 200)}`);
    }
  }
}

async function ensureCustomObject(definition) {
  let obj = await twenty.getObjectByName(definition.nameSingular);

  if (!obj) {
    log.info(`Creating custom object "${definition.labelSingular}"...`);
    try {
      obj = await twenty.createObject(definition);
      log.ok(`Created "${definition.labelSingular}" custom object`);
    } catch (err) {
      log.error(`Failed to create "${definition.labelSingular}": ${err.message.slice(0, 300)}`);
      throw err;
    }
  } else {
    log.info(`Custom object "${definition.labelSingular}" already exists`);
  }

  const objId = obj?.data?.id || obj?.id;
  if (!objId) {
    throw new Error(`Could not determine ID for "${definition.labelSingular}"`);
  }
  return objId;
}

async function ensureRelation(fromObjId, fromLabel, fromName, fromIcon, toObjId, toLabel, toName, toIcon) {
  // Check if relation field already exists
  const existing = await getFieldsForObject(fromObjId);
  const relationFieldName = `${toName}Id`;
  if (existing.has(relationFieldName) || existing.has(toName)) {
    log.info(`  Relation "${fromName}" → "${toName}" already exists, skipping`);
    return;
  }

  try {
    await twenty.createRelation({
      relationType: 'MANY_TO_ONE',
      fromObjectMetadataId: fromObjId,
      fromLabel,
      fromName,
      fromIcon,
      toObjectMetadataId: toObjId,
      toLabel,
      toName,
      toIcon,
    });
    log.ok(`  Created relation: ${fromLabel} → ${toLabel}`);
  } catch (err) {
    log.warn(`  Could not create relation ${fromLabel} → ${toLabel}: ${err.message.slice(0, 200)}`);
  }
}

export async function run() {
  const progress = loadProgress();
  if (progress.schema.completed) {
    log.info('Schema setup already completed, skipping');
    return;
  }

  log.info('Setting up custom objects, fields, and relations in Twenty CRM...');

  const test = await twenty.testConnection();
  if (!test.ok) {
    log.error(`Cannot connect to Twenty CRM: ${test.error}`);
    throw new Error('Twenty API connection failed');
  }
  log.ok('Connected to Twenty CRM');

  // 1. Create custom objects
  log.info('Creating custom objects...');
  const facilityObjId = await ensureCustomObject(FACILITY_OBJECT);
  const qualityObjId = await ensureCustomObject(QUALITY_OBJECT);
  const affiliationObjId = await ensureCustomObject(AFFILIATION_OBJECT);

  // 2. Add fields to custom objects
  log.info('Adding fields to Healthcare Facility...');
  await ensureCustomFields(facilityObjId, 'healthcareFacility', FACILITY_FIELDS);

  log.info('Adding fields to Quality Measure...');
  await ensureCustomFields(qualityObjId, 'qualityMeasure', QUALITY_FIELDS);

  log.info('Adding fields to Provider Affiliation...');
  await ensureCustomFields(affiliationObjId, 'providerAffiliation', AFFILIATION_FIELDS);

  // 3. Add enhanced fields to Person
  const personObj = await twenty.getObjectByName('person');
  if (personObj) {
    const personObjId = personObj.id;
    log.info('Adding NPI fields to Person...');
    await ensureCustomFields(personObjId, 'person', PERSON_CUSTOM_FIELDS);

    // 4. Create relations
    log.info('Creating relations...');

    // qualityMeasure → healthcareFacility
    await ensureRelation(
      qualityObjId, 'Facility', 'facility', 'IconBuildingHospital',
      facilityObjId, 'Quality Measures', 'qualityMeasures', 'IconChartBar',
    );

    // providerAffiliation → healthcareFacility
    await ensureRelation(
      affiliationObjId, 'Facility', 'facility', 'IconBuildingHospital',
      facilityObjId, 'Provider Affiliations', 'providerAffiliations', 'IconLink',
    );

    // providerAffiliation → person
    await ensureRelation(
      affiliationObjId, 'Provider', 'provider', 'IconUser',
      personObjId, 'Facility Affiliations', 'facilityAffiliations', 'IconLink',
    );
  } else {
    log.error('Person object not found — cannot add fields or relations');
  }

  progress.schema.completed = true;
  progress.currentPhase = 'facilities';
  saveProgress();

  log.ok('Schema setup complete');
}
