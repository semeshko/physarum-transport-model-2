import {SMALL_OSM_RESPONSE_FIXTURE} from "../osm/fixtures";
import {overpassResponseToGeoJSON} from "../osm/adapter";
import {ingestGeoJSON} from "../gis/ingest";
import {createEmptyScenario} from "../scenario/scenario";
import {DEFAULT_PHYSARUM_PARAMETERS} from "../physarum/parameters";
import {DEFAULT_SPATIAL_POLICY} from "../spatial-constraints/types";
import {INITIAL_CAMERA,type ProjectSnapshot} from "./document";
export function snapshot():ProjectSnapshot {
  const converted=overpassResponseToGeoJSON(SMALL_OSM_RESPONSE_FIXTURE);
  const dataset=ingestGeoJSON(converted.featureCollection,{name:"Квартал Львів",source:{kind:"osm",name:"OSM fixture"}});
  return {dataset,aoi:dataset.bounds,osmSummary:null,allowIncompleteContext:false,scenario:createEmptyScenario(),parameters:{...DEFAULT_PHYSARUM_PARAMETERS,hillK:1.25},spatialPolicy:{...DEFAULT_SPATIAL_POLICY},camera:INITIAL_CAMERA,projection:"mercator",visibility:{roadsPaths:true,buildings:true,water:true,green:true},graphVisibility:{edges:true,nodes:true},costVisible:false,spatialVisible:true,result:null};
}
