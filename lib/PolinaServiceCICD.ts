import * as cdk from '@aws-cdk/core';
import { Artifact, Pipeline } from '@aws-cdk/aws-codepipeline';
import {
    BuildEnvironment,
    BuildEnvironmentVariable,
    BuildEnvironmentVariableType,
    BuildSpec,
    LinuxBuildImage,
    PipelineProject,
} from '@aws-cdk/aws-codebuild';
import {
    CloudFormationCreateUpdateStackAction,
    CodeBuildAction,
    CodeStarConnectionsSourceAction,
    ManualApprovalAction,
} from '@aws-cdk/aws-codepipeline-actions';
import { CfnParametersCode } from '@aws-cdk/aws-lambda';
import PolinaServiceStack from './PolinaServiceStack';
import Environment from './Environment';

type StackInfo = {
    lambdaCode: CfnParametersCode;
    apiURL: string;
}

interface PolinaServiceCICDPipelineProps extends cdk.StackProps {
    ppdStack: StackInfo;
    prdStack: StackInfo
}

class PolinaServiceCICDPipeline extends cdk.Stack {
    constructor(
        scope: cdk.Construct,
        id: string,
        props: PolinaServiceCICDPipelineProps,
    ) {
        super(scope, id, props);
    
        const { ppdStack, prdStack } = props;

        // Source code - Github
        const sourceOutput = new Artifact();
        const codeStarAction = new CodeStarConnectionsSourceAction({
            actionName: 'CheckoutFromGithub',
            // eslint-disable-next-line max-len
            connectionArn: 'arn:aws:codestar-connections:us-east-1:502192330072:connection/8dafd691-9f69-4553-a212-735cb6810389',
            output: sourceOutput,
            owner: 'TestLambdaProjectOrg',
            repo: 'polina-service',
            branch: 'main',
        });

        const cdkSourceOutput = new Artifact();
        const cdkCodeStarAction = new CodeStarConnectionsSourceAction({
            actionName: 'CDKCodeFromGithub',
            // eslint-disable-next-line max-len
            connectionArn: 'arn:aws:codestar-connections:us-east-1:502192330072:connection/8dafd691-9f69-4553-a212-735cb6810389',
            output: cdkSourceOutput,
            owner: 'TestLambdaProjectOrg',
            repo: 'polina-service-devops',
            branch: 'main',
        });
        
        // CDK Pipeline Stack
        const cdkBuildOutput = new Artifact('CdkBuildOutput');
        const cdkBuildProject = this.getCdkBuild();
        const cdkBuildAction = new CodeBuildAction({
            actionName: 'CDK_BuildAction',
            project: cdkBuildProject,
            input: cdkSourceOutput,
            outputs: [cdkBuildOutput],
        });

        // PolinaHandler Lambda Stack - Preproduction
        const polinaHandlerBuildOutputPPD = new Artifact('PolinaHandlerBuildOutputPPD');
        const polinaHandlerBuildProjectPPD = this.getGoLambdaBuild(
            Environment.PPD,
            'PolinaHandler',
            '.',
            'polinahandler',
        );
        const polinaHandlerBuildActionPPD = new CodeBuildAction({
            actionName: 'PolinaHandlerPPD_BuildAction',
            project: polinaHandlerBuildProjectPPD,
            input: sourceOutput,
            outputs: [polinaHandlerBuildOutputPPD],
        });

        // PolinaHandler Lambda Stack - Production
        const polinaHandlerBuildOutputPRD = new Artifact('PolinaHandlerBuildOutputPRD');
        const polinaHandlerBuildProjectPRD = this.getGoLambdaBuild(
            Environment.PRD,
            'PolinaHandler',
            '.',
            'polinahandler',
        );
        const polinaHandlerBuildActionPRD = new CodeBuildAction({
            actionName: 'PolinaHandler_BuildAction',
            project: polinaHandlerBuildProjectPRD,
            input: sourceOutput,
            outputs: [polinaHandlerBuildOutputPRD],
        });

        // Deployment - Preproduction
        const templateArtifactPathPPD = cdkBuildOutput.atPath(
            // eslint-disable-next-line max-len
            `${PolinaServiceStack.STACK_NAME}${Environment.PPD}.template.json`,
        );
        const deployActionPPD = new CloudFormationCreateUpdateStackAction({
            actionName: 'PolinaHandler_Cfn_Deploy_Preproduction',
            templatePath: templateArtifactPathPPD,
            parameterOverrides: {
                ...ppdStack.lambdaCode.assign(polinaHandlerBuildOutputPPD.s3Location),
            },
            stackName: `${PolinaServiceStack.STACK_NAME}${Environment.PPD}`,
            adminPermissions: true,
            extraInputs: [cdkBuildOutput, polinaHandlerBuildOutputPPD],
        });

        // Deployment - Production
        const templateArtifactPathPRD = cdkBuildOutput.atPath(
            // eslint-disable-next-line max-len
            `${PolinaServiceStack.STACK_NAME}${Environment.PRD}.template.json`,
        );
        const deployActionPRD = new CloudFormationCreateUpdateStackAction({
            actionName: 'PolinaHandler_Cfn_Deploy_Production',
            templatePath: templateArtifactPathPRD,
            parameterOverrides: {
                ...prdStack.lambdaCode.assign(polinaHandlerBuildOutputPRD.s3Location),
            },
            stackName: `${PolinaServiceStack.STACK_NAME}${Environment.PRD}`,
            adminPermissions: true,
            extraInputs: [cdkBuildOutput, polinaHandlerBuildOutputPRD],
        });

        const pipeline = new Pipeline(this, 'PolinaServiceCICDPipeline', {
            crossAccountKeys: false,
            stages: [
                {
                    stageName: 'Source',
                    actions: [
                        codeStarAction,
                        cdkCodeStarAction,
                    ],
                },
                {
                    stageName: 'Build-CDK',
                    actions: [
                        cdkBuildAction,
                    ],
                },
                {
                    stageName: 'Build-PPD',
                    actions: [
                        polinaHandlerBuildActionPPD,
                    ],
                },
                {
                    stageName: 'Deploy-PPD',
                    actions: [
                        deployActionPPD,
                        new ManualApprovalAction({
                            actionName: 'DeployPolinaServiceToProductionApproval',
                            additionalInformation: 'Ready to deploy to Production?',
                            // TODO: uncomment after first successful pipeline run
                            // externalEntityLink: ppdStack.apiURL,
                            runOrder: 2,
                        }),
                    ],
                },
                {
                    stageName: 'Build-PRD',
                    actions: [
                        polinaHandlerBuildActionPRD,
                    ],
                },
                {
                    stageName: 'Deploy-PRD',
                    actions: [
                        deployActionPRD,
                    ],
                },
            ],
          });
    }

    private getCdkBuild(): PipelineProject {
        const buildSpec = BuildSpec.fromObject({
            version: '0.2',
            phases: {
                install: {
                    commands: 'npm install',
                },
                build: {
                    commands: [
                        'npm run build',
                        'npm run cdk synth -- -o dist',
                    ],
                },
            },
            artifacts: {
                'base-directory': 'dist',
                files: [
                    // eslint-disable-next-line max-len
                    `${PolinaServiceStack.STACK_NAME}${Environment.PPD}.template.json`,
                    // eslint-disable-next-line max-len
                    `${PolinaServiceStack.STACK_NAME}${Environment.PRD}.template.json`,
                ],
            },
        });
    
        const environment: BuildEnvironment = {
            buildImage: LinuxBuildImage.STANDARD_5_0,
        };
    
        return new PipelineProject(this, `CDKBuildProject`, {
            buildSpec,
            environment,
        });
    }

    private getGoLambdaBuild(
        appEnv: Environment,
        lambdaFnName: string,
        baseDirectory: string,
        outputFileName: string,
        variables: {[index: string]: BuildEnvironmentVariable} = {},
    ): PipelineProject {
        const buildSpec = BuildSpec.fromObject({
            version: '0.2',
            phases: {
                install: {
                    commands: [
                        `cd ${baseDirectory}`,
                        'go get ./...',
                    ],
                },
                build: {
                    commands: [
                        `go build -o ${outputFileName}`,
                    ],
                },
            },
            artifacts: {
                'base-directory': baseDirectory,
                files: [
                    outputFileName,
                ],
            },
        });
    
        const environmentVariables = {
            APP_ENV: {
                value: appEnv,
                type: BuildEnvironmentVariableType.PLAINTEXT,
            },
            ...variables,
        };

        return new PipelineProject(this, `${lambdaFnName}${appEnv}-LambdaBuild`, {
            buildSpec,
            environment: {
                buildImage: LinuxBuildImage.STANDARD_2_0,
                environmentVariables,
            },
        });
    }
}

export default PolinaServiceCICDPipeline;