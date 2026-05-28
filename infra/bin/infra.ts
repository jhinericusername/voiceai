#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { configFromApp } from '../lib/config';
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
