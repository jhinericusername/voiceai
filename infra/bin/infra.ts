#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { configFromApp } from '../lib/config';
import {
  FirefliesIngestionSourceStack,
  WEAVE_HISTORICAL_RECORDINGS_BUCKET_ACCOUNT,
  WEAVE_HISTORICAL_RECORDINGS_BUCKET_REGION,
} from '../lib/fireflies-ingestion-source-stack';
import { InfraStack } from '../lib/infra-stack';

const app = new cdk.App();
const config = configFromApp(app);

new InfraStack(app, config.stackName, {
  env: {
    account: config.account,
    region: config.region,
  },
  config,
});

if (config.backend.deployService) {
  new FirefliesIngestionSourceStack(app, `${config.stackName}-FirefliesSource`, {
    env: {
      account: WEAVE_HISTORICAL_RECORDINGS_BUCKET_ACCOUNT,
      region: WEAVE_HISTORICAL_RECORDINGS_BUCKET_REGION,
    },
    config,
  });
}
