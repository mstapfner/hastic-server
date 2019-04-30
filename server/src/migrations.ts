import { Collection, makeDBQ } from './services/data_service';

import * as _ from 'lodash';


const metaDB = makeDBQ(Collection.DB_META);
const analyticUnitsDB = makeDBQ(Collection.ANALYTIC_UNITS);
const analyticUnitCachesDB = makeDBQ(Collection.ANALYTIC_UNIT_CACHES);

const DB_META_ID = '0';

type DbMeta = {
  revision: number
};

const REVISIONS = new Map<number, Function>([
  [1, convertPanelUrlToPanelId],
  [2, convertUnderscoreToCamelCase]
]);

export async function applyDBMigrations() {
  let meta: DbMeta = await metaDB.findOne(DB_META_ID);
  if(meta === null) {
    meta = { revision: 0 };
    await metaDB.insertOne({ _id: DB_META_ID, ...meta });
  }

  await REVISIONS.forEach(async (migration, revision) => {
    if(meta.revision < revision) {
      console.log(`Applying migration ${revision}`);
      await migration();

      meta.revision = revision;
      await metaDB.updateOne(DB_META_ID, meta);
    }
  });
}

async function convertPanelUrlToPanelId() {
  const analyticUnits = await analyticUnitsDB.findMany({ panelUrl: { $exists: true } });
  console.log(`Found ${analyticUnits.length} analytic units with panelUrl field`);
  if(analyticUnits.length === 0) {
    console.log('Nothing to migrate');
    return;
  }

  const PANEL_URL_REGEX = /^(.+)\/d\/([^\/]+)\/.+panelId=(\d+)/;
  const NEW_PANEL_URL_REGEX = /^(.+)\/dashboard\/(\w+).+panelId=(\d+)/;
  const updatedAnalyticUnits = analyticUnits
    .map(analyticUnit => {
      const parsedPanelUrl = analyticUnit.panelUrl.match(PANEL_URL_REGEX) || analyticUnit.panelUrl.match(NEW_PANEL_URL_REGEX);
      if(parsedPanelUrl === null) {
        console.log(`Cannot parse url: ${analyticUnit.panelUrl}`);
        return null;
      }
      const grafanaUrl = parsedPanelUrl[1];
      const dashboardId = parsedPanelUrl[2];
      const oldPanelId = parsedPanelUrl[3];
      const panelId = `${dashboardId}/${oldPanelId}`;

      return {
        _id: analyticUnit._id,
        grafanaUrl,
        panelId
      };
    })
    .filter(analyticUnit => analyticUnit !== null);

  console.log(updatedAnalyticUnits);
  const promises = updatedAnalyticUnits.map(analyticUnit =>
    analyticUnitsDB.updateOne(analyticUnit._id, {
      panelUrl: undefined,
      ...analyticUnit
    })
  );

  await Promise.all(promises);
}

async function convertUnderscoreToCamelCase() {
  const analyticUnitCaches = await analyticUnitCachesDB.findMany({});

  const updatedAnalyticUnitCaches = analyticUnitCaches.map(analyticUnitCache => {
    let data = null;
    if(analyticUnitCache.data !== null) {
      data = _.mapKeys(analyticUnitCache.data, (value, key) => _.camelCase(key));
    }

    return { data, _id: analyticUnitCache._id };
  });

  const promises = updatedAnalyticUnitCaches.map(analyticUnitCache =>
    analyticUnitCachesDB.updateOne(analyticUnitCache._id, { data: analyticUnitCache.data })
  );

  await Promise.all(promises);
}