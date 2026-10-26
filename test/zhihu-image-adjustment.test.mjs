import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSettings, FEATURE_IDS, DEFAULT_INCOGNITO_SETTINGS } from '../extension/core/config.js';
import { settingsViewCache } from '../extension/core/settings-view-cache.js';
import { isZhihuPage, zhihuImageAdjustmentState } from '../extension/core/zhihu-image-adjustment.js';
import { SETTINGS_DIRECTORIES } from '../extension/settings/views.js';
import { createZhihuImageAdjustmentProduct } from '../extension/background/products/operations/zhihu-image-adjustment.js';

test('Zhihu scope, defaults, independent preferences, and first-frame cache agree', () => {
  for (const url of ['https://zhihu.com/', 'https://www.zhihu.com/question/1', 'https://zhuanlan.zhihu.com/p/1', 'https://a.b.zhihu.com/']) assert.equal(isZhihuPage(url), true);
  for (const url of ['https://zhihu.com.evil.test/', 'https://notzhihu.com/', 'file://zhihu.com/a', 'not a URL']) assert.equal(isZhihuPage(url), false);
  assert.equal(SETTINGS_DIRECTORIES.at(-1).items.at(-1).target,'orbiter-zhihu-image-adjustment');
  const defaults = normalizeSettings({});
  assert.deepEqual(defaults.zhihuImageAdjustment, {enabled:false,smallImages:true,darkImages:true,matchPageTheme:true});
  assert.equal(DEFAULT_INCOGNITO_SETTINGS.zhihuImageAdjustment.enabled, false);
  assert.equal(zhihuImageAdjustmentState(defaults,'https://zhihu.com').active,false);
  for (const smallImages of [true,false]) for (const darkImages of [true,false]) {
    const settings=normalizeSettings({zhihuImageAdjustment:{enabled:true,smallImages,darkImages}});
    assert.deepEqual(settingsViewCache(settings).zhihuImageAdjustment,settings.zhihuImageAdjustment);
    assert.equal(zhihuImageAdjustmentState(settings,'https://zhuanlan.zhihu.com/p/1').active,smallImages||darkImages);
    assert.equal(zhihuImageAdjustmentState(settings,'https://elsewhere.test').active,false);
  }
});

test('Operations product isolates writes, rejects unsupported commands, and never injects a child frame',async()=>{
  let settings=normalizeSettings({xhsImageDarkMode:{enabled:true}}), refreshes=0; const calls=[];
  const product=createZhihuImageAdjustmentProduct({async sync(...args){calls.push(args);}}, {
    async getLocale(){return 'zh-CN';}, async readSettings(){return settings;},
    async mutateSettings(change){settings=change(settings);return settings;},async refreshOpenPages(){refreshes++;}
  });
  await product.handleMessage({type:'UI_SET_ENABLED',featureId:FEATURE_IDS.ZHIHU_IMAGE_ADJUSTMENT,enabled:true});
  await product.handleMessage({type:'UI_SET_ZHIHU_IMAGE_SETTING',featureId:product.id,name:'smallImages',value:false});
  assert.deepEqual(settings.zhihuImageAdjustment,{enabled:true,smallImages:false,darkImages:true,matchPageTheme:true});
  assert.equal(settings.xhsImageDarkMode.enabled,true);assert.equal(refreshes,2);
  assert.equal((await product.state(settings,'https://zhihu.com')).locale,'zh-CN');
  assert.equal(await product.sync({frameId:1,topUrl:'https://zhihu.com'},settings),false);
  assert.equal(calls.at(-1)[2],false);
  await assert.rejects(product.handleMessage({type:'UI_SET_ZHIHU_IMAGE_SETTING',featureId:product.id,name:'whitelist',value:true}));
  await product.handleMessage({type:'UI_SET_ZHIHU_IMAGE_SETTING',featureId:product.id,name:'darkImages',value:false});
  assert.equal(await product.sync({frameId:0,topUrl:'https://zhihu.com'},settings),false);
});
