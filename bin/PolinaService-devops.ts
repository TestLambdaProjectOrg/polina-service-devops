#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import Environment from '../lib/Environment';
import PolinaServiceStack from '../lib/PolinaServiceStack';
import PolinaServiceCICD from '../lib/PolinaServiceCICD';

const app = new cdk.App();

const ppdStack = new PolinaServiceStack(
  app,
  `${PolinaServiceStack.STACK_NAME}${Environment.PPD}`,
  {
  //   env: { region: 'us-east-1' },
    appEnv: Environment.PPD,
  },
);

const prdStack = new PolinaServiceStack(
  app,
  `${PolinaServiceStack.STACK_NAME}${Environment.PRD}`,
  {
  //   env: { region: 'us-east-1' },
    appEnv: Environment.PRD,
  },
);

// eslint-disable-next-line no-new
new PolinaServiceCICD(
  app,
  'PolinaServiceCICDStack',
  {
    ppdStack: {
      lambdaCode: ppdStack.polinaHandlerHandlerCode,
      apiURL: ppdStack.httpApi.url!,
    },
    prdStack: {
      lambdaCode: prdStack.polinaHandlerHandlerCode,
      apiURL: prdStack.httpApi.url!,
    },
  },
);

app.synth();