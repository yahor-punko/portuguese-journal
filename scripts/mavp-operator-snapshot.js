#!/usr/bin/env node

const { collectOperatorData, renderThinSnapshot } = require('./mavp-operator-lib');

console.log(renderThinSnapshot(collectOperatorData()));
