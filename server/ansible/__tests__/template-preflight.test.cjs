// server/ansible/__tests__/template-preflight.test.cjs
//
// 2026-08-09: portal `logx_ocp_app_discovery` job'ini DOLU extra_vars ile tetikledi, AWX
// job'i basariyla acti, ama playbook bos girdiyle calisip "En az bir bastion ... gerekli"
// assert'i ile dustu; AWX arayuzunde degiskenler `{}` gorunuyordu. Sebep: job template'inde
// "Prompt on launch" (ask_variables_on_launch) KAPALI oldugunda AWX gonderilen extra_vars'i
// SESSIZCE yok sayar. Bu testler o sessiz yutmanin launch'tan once yakalandigini kilitler.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const preflight = require('../template-preflight.cjs');
const runner = require('../runner.cjs');

function withTemplates(templates, fn, { servers = [{ id: 1, name: 'awx1' }] } = {}) {
  const origServers = runner.getServers;
  const origList = runner.listTemplatesForServer;
  runner.getServers = () => servers;
  runner.listTemplatesForServer = async () => templates;
  return Promise.resolve(fn()).finally(() => {
    runner.getServers = origServers;
    runner.listTemplatesForServer = origList;
  });
}

const VARS = { ocp_clusters: [{ cluster_name: 'gbocpprod2' }], terminal_host: 'GBARKP52' };

test('ask_variables=false + DOLU extra_vars → 503 ile reddedilir', async () => {
  await withTemplates([{ id: 42, name: 'LogX OCP App Discovery', ask_variables: false }], async () => {
    await assert.rejects(
      () => preflight.assertTemplateAcceptsExtraVars(1, 42, VARS, { label: 'logx_ocp_app_discovery' }),
      (err) => {
        assert.equal(err.status, 503);
        assert.equal(err.code, 'awx_prompt_on_launch_disabled');
        // Mesaj NE YAPILACAGINI soylemeli — teshis uretimde saatler almisti.
        assert.match(err.message, /Prompt on launch/i);
        assert.match(err.message, /logx_ocp_app_discovery/);
        return true;
      }
    );
  });
});

test('ask_variables=true → launch bloklanmaz', async () => {
  await withTemplates([{ id: 42, name: 'ok', ask_variables: true }], async () => {
    await preflight.assertTemplateAcceptsExtraVars(1, 42, VARS);
  });
});

test('extra_vars BOSSA kontrol hic calismaz (AWX\'e gidilmez)', async () => {
  let listed = false;
  const origServers = runner.getServers;
  const origList = runner.listTemplatesForServer;
  runner.getServers = () => [{ id: 1 }];
  runner.listTemplatesForServer = async () => { listed = true; return []; };
  try {
    await preflight.assertTemplateAcceptsExtraVars(1, 42, {});
    await preflight.assertTemplateAcceptsExtraVars(1, 42, null);
    await preflight.assertTemplateAcceptsExtraVars(1, 42, undefined);
    assert.equal(listed, false, 'bos extra_vars icin AWX sorgulanmamali');
  } finally {
    runner.getServers = origServers;
    runner.listTemplatesForServer = origList;
  }
});

test('FAIL-OPEN: template metadata alinamazsa mesru is DURDURULMAZ', async () => {
  // Sunucu listede yok
  await withTemplates([], async () => {
    await preflight.assertTemplateAcceptsExtraVars(99, 42, VARS);
  });
  // Template listede yok
  await withTemplates([{ id: 7, ask_variables: false }], async () => {
    await preflight.assertTemplateAcceptsExtraVars(1, 42, VARS);
  });
  // AWX patliyor
  const origServers = runner.getServers;
  const origList = runner.listTemplatesForServer;
  runner.getServers = () => [{ id: 1 }];
  runner.listTemplatesForServer = async () => { throw new Error('AWX 500'); };
  try {
    await preflight.assertTemplateAcceptsExtraVars(1, 42, VARS);
  } finally {
    runner.getServers = origServers;
    runner.listTemplatesForServer = origList;
  }
});

test('ask_variables tanimsizsa (eski AWX yaniti) bloklanmaz — yalniz KESIN false engeller', async () => {
  await withTemplates([{ id: 42, name: 'eski' }], async () => {
    await preflight.assertTemplateAcceptsExtraVars(1, 42, VARS);
  });
});
