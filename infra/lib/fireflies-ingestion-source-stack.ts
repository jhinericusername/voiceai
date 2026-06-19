import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { PuddleEnvConfig } from './config';

export interface FirefliesIngestionSourceStackProps extends cdk.StackProps {
  config: PuddleEnvConfig;
}

export const WEAVE_HISTORICAL_RECORDINGS_BUCKET_NAME =
  'weave-fireflies-prod-851725544921-us-west-2';
export const WEAVE_HISTORICAL_RECORDINGS_BUCKET_REGION = 'us-west-2';
export const WEAVE_HISTORICAL_RECORDINGS_BUCKET_ACCOUNT = '851725544921';
export const WEAVE_HISTORICAL_RECORDINGS_PREFIX = 'raw/fireflies/';
export const WEAVE_HISTORICAL_RECORDINGS_KMS_KEY_ARN =
  'arn:aws:kms:us-west-2:851725544921:key/34ca088f-7a67-4cd8-b3a3-ba52cbfe4a73';
export const FIREFLIES_INGESTION_QUEUE_SUFFIX = 'fireflies-ingestion';
export const FIREFLIES_INGESTION_DLQ_SUFFIX = 'fireflies-ingestion-dlq';

export class FirefliesIngestionSourceStack extends cdk.Stack {
  private readonly cfg: PuddleEnvConfig;

  constructor(scope: Construct, id: string, props: FirefliesIngestionSourceStackProps) {
    super(scope, id, props);

    this.cfg = props.config;
    const removalPolicy =
      this.cfg.envName === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;
    const source = this.importSourceBucket();
    const deadLetterQueue = new sqs.Queue(this, 'FirefliesIngestionDeadLetterQueue', {
      queueName: this.name(FIREFLIES_INGESTION_DLQ_SUFFIX),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      retentionPeriod: cdk.Duration.days(14),
      removalPolicy,
    });
    const queue = new sqs.Queue(this, 'FirefliesIngestionQueue', {
      queueName: this.name(FIREFLIES_INGESTION_QUEUE_SUFFIX),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      retentionPeriod: cdk.Duration.days(4),
      visibilityTimeout: cdk.Duration.minutes(15),
      deadLetterQueue: {
        queue: deadLetterQueue,
        maxReceiveCount: 10,
      },
      removalPolicy,
    });

    queue.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal('s3.amazonaws.com')],
        actions: ['sqs:SendMessage'],
        resources: [queue.queueArn],
        conditions: {
          ArnEquals: {
            'aws:SourceArn': source.bucket.bucketArn,
          },
          StringEquals: {
            'aws:SourceAccount': WEAVE_HISTORICAL_RECORDINGS_BUCKET_ACCOUNT,
          },
        },
      }),
    );
    source.bucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SqsDestination(queue),
      { prefix: WEAVE_HISTORICAL_RECORDINGS_PREFIX },
    );

    new cdk.CfnOutput(this, 'FirefliesIngestionQueueUrl', {
      value: queue.queueUrl,
    });
    new cdk.CfnOutput(this, 'FirefliesIngestionQueueArn', {
      value: queue.queueArn,
    });
    new cdk.CfnOutput(this, 'FirefliesIngestionDeadLetterQueueUrl', {
      value: deadLetterQueue.queueUrl,
    });
  }

  private importSourceBucket(): { bucket: s3.IBucket } {
    const bucket = s3.Bucket.fromBucketAttributes(
      this,
      'WeaveHistoricalRecordingsBucket',
      {
        bucketName: WEAVE_HISTORICAL_RECORDINGS_BUCKET_NAME,
        account: WEAVE_HISTORICAL_RECORDINGS_BUCKET_ACCOUNT,
        region: WEAVE_HISTORICAL_RECORDINGS_BUCKET_REGION,
      },
    );

    return { bucket };
  }

  private name(suffix: string): string {
    return `${this.cfg.resourcePrefix}-${suffix}`;
  }
}
