import { CorsHttpMethod, HttpApi, HttpMethod } from '@aws-cdk/aws-apigatewayv2';
import { LambdaProxyIntegration } from '@aws-cdk/aws-apigatewayv2-integrations';
import { CfnParametersCode, Code, Function, Runtime } from '@aws-cdk/aws-lambda';
import * as cdk from '@aws-cdk/core';
import Environment from './Environment';

interface PolinaServiceStackProps extends cdk.StackProps {
  appEnv: Environment;
}

class PolinaServiceStack extends cdk.Stack {
  public static readonly STACK_NAME = 'PolinaServiceStack';

  public readonly cfnOutputAPI: cdk.CfnOutput;

  private readonly appEnv: Environment;

  public httpApi: HttpApi;

  public polinaHandlerHandlerCode: CfnParametersCode;

  constructor(
    scope: cdk.Construct, 
    id: string, 
    props: PolinaServiceStackProps
  ) {
    super(scope, id, props);

    this.appEnv = props.appEnv;

    this.polinaHandlerHandlerCode = Code.fromCfnParameters();
    
    const polinaHandler = new Function(
      this,
      `PolinaHandlerHandler${this.appEnv}`,
      {
        runtime: Runtime.GO_1_X,
        handler: 'polinahandler',
        code: this.polinaHandlerHandlerCode,
        environment: {
          APP_ENV: this.appEnv,
        },
      },
    );
    
    const polinaHandlerIntegration = new LambdaProxyIntegration({
      handler: polinaHandler,
    });

    this.httpApi = new HttpApi(this, `PolinaServiceHttpAPI${this.appEnv}`, {
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [CorsHttpMethod.ANY],
      },
      apiName: 'polina-service-api',
      createDefaultStage: true,
    });

    this.httpApi.addRoutes({
      path: '/',
      methods: [
        HttpMethod.GET,
      ],
      integration: polinaHandlerIntegration,
    });

    this.cfnOutputAPI = new cdk.CfnOutput(
      this,
      `PolinaServiceAPI${this.appEnv}`, {
        value: this.httpApi.url!,
        exportName: `PolinaServiceAPIEndpoint${this.appEnv}`,
      },
    );
  }
}

export default PolinaServiceStack;
