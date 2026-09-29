// server/tools/index.js
import { searchWoRMSDeclaration, searchWoRMS } from './worms.js';
import { searchFishBaseDeclaration, searchFishBase } from './fishbase.js';
import { searchOBISDeclaration, searchOBIS } from './obis.js';
import { searchERDDAPDeclaration, searchERDDAP } from './erddap.js';

export const toolDeclarations = [
  searchWoRMSDeclaration,
  searchFishBaseDeclaration,
  searchOBISDeclaration,
  searchERDDAPDeclaration
];

export const toolHandlers = {
  searchWoRMS,
  searchFishBase,
  searchOBIS,
  searchERDDAP
};
