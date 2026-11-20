import {defineConfig} from '@playwright/test'

const baseURL = 'http://127.0.0.1:18031'
export default defineConfig({
  testDir:'./tests',
  testMatch:'workspace.spec.ts',
  outputDir:'output/playwright/regression',
  use:{baseURL,screenshot:'only-on-failure',launchOptions:{executablePath:process.env.FOLIO_TEST_CHROMIUM}},
  webServer:{command:'node --experimental-strip-types server/local.js',port:18031,env:{PORT:'18031'}},
})
