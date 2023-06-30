/*********************************************************************************************************************
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.                                           *
 *                                                                                                                    *
 *  Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance    *
 *  with the License. A copy of the License is located at                                                             *
 *                                                                                                                    *
 *      http://www.apache.org/licenses/LICENSE-2.0                                                                    *
 *                                                                                                                    *
 *  or in the 'license' file accompanying this file. This file is distributed on an 'AS IS' BASIS, WITHOUT WARRANTIES *
 *  OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific language governing permissions    *
 *  and limitations under the License.                                                                                *
 *********************************************************************************************************************/
const AWS = require('aws-sdk');
const url = require('url');

const createEndPoint = async (config) => {
    const mediapackage = new AWS.MediaPackage({
        region: process.env.AWS_REGION,
        customUserAgent: process.env.SOLUTION_IDENTIFIER
    });
    let responseData;
    try {
        //Define specific configuration settings for each endpoint type (HLS/DASH/MSS/CMAF)
        let packages = {
            HlsPackage: {
                IncludeIframeOnlyStream: false,
                PlaylistType: 'NONE',
                PlaylistWindowSeconds: 60,
                ProgramDateTimeIntervalSeconds: 0,
                SegmentDurationSeconds: 6,
                UseAudioRenditionGroup: false,
                AdMarkers: 'PASSTHROUGH'
            },
            DashPackage: {
                ManifestWindowSeconds: 60,
                MinBufferTimeSeconds: 4,
                MinUpdatePeriodSeconds: 15,
                Profile: 'NONE',
                SegmentDurationSeconds: 2,
                SuggestedPresentationDelaySeconds: 2
            },
            MssPackage: {
                ManifestWindowSeconds: 60,
                SegmentDurationSeconds: 2
            },
            CmafPackage: {
                SegmentDurationSeconds: 6,
                HlsManifests: [{
                    Id: 'cmaf',
                    AdMarkers: 'PASSTHROUGH',
                    IncludeIframeOnlyStream: false,
                    PlaylistType: 'NONE',
                    PlaylistWindowSeconds: 60,
                    ProgramDateTimeIntervalSeconds: 0
                }]
            }
        };
        let params = {
            ChannelId: config.ChannelId,
            Description: 'Live Streaming on AWS Solution',
            ManifestName: 'index',
            StartoverWindowSeconds: 0,
            TimeDelaySeconds: 0,
            Authorization: {
                CdnIdentifierSecret: config.CdnIdentifierSecret,
                SecretsRoleArn: config.SecretsRoleArn
            },
            Tags: {
                SolutionId: 'SO0013'
            }
        };
        //Add configuration based on the endpoint type defined in config
        switch (config.EndPoint) {
            case 'HLS':
                params.Id = config.ChannelId + '-hls';
                params.HlsPackage = packages.HlsPackage;
                break;
            case 'DASH':
                params.Id = config.ChannelId + '-dash';
                params.DashPackage = packages.DashPackage;
                break;
            case 'MSS':
                params.Id = config.ChannelId + '-mss';
                params.MssPackage = packages.MssPackage;
                break;
            case 'CMAF':
                params.Id = config.ChannelId + '-cmaf';
                params.CmafPackage = packages.CmafPackage;
                break;
            default:
                console.log('Error EndPoint not defined');
        }
        // Create Endpoint & return detials
        const data = await mediapackage.createOriginEndpoint(params).promise();

        let Url;
        if (config.EndPoint === 'CMAF') {
            Url = url.parse(data.CmafPackage.HlsManifests[0].Url);
        } else {
          Url = url.parse(data.Url);
        }

        responseData = {
            Id: data.Id,
            DomainName: Url.hostname,
            Path: '/' + Url.pathname.split('/')[3],
            Manifest: Url.pathname.slice(7)
        };
    } catch (err) {
        console.error(err);
        throw err;
    }
    return responseData;
};


// FEATURE/P15424610:: Function updated to use Async
const createChannel = async (config) => {
    const mediapackage = new AWS.MediaPackage({
        region: process.env.AWS_REGION,
        customUserAgent: process.env.SOLUTION_IDENTIFIER
    });
    const ssm = new AWS.SSM({
        region: process.env.AWS_REGION,
        customUserAgent: process.env.SOLUTION_IDENTIFIER
    });
    let responseData;

    try {

        let params = {
            Id: config.ChannelId,
            Description: 'Live Streaming on AWS Solution',
            Tags: {
                SolutionId: 'SO0013'
            }
        };
        let data = await mediapackage.createChannel(params).promise();

        responseData = {
            Arn: data.Arn,
            ChannelId: config.ChannelId,
            PrimaryUrl: data.HlsIngest.IngestEndpoints[0].Url,
            PrimaryUser: data.HlsIngest.IngestEndpoints[0].Username,
            PrimaryPassParam: data.HlsIngest.IngestEndpoints[0].Username,
            // FEATURE/P15424610:: Dual ingest support added to MediaPackage, returning
            // details for both Ingest Endpoints. Update due for GA 08/28
            SecondaryUrl: data.HlsIngest.IngestEndpoints[1].Url,
            SecondaryUser: data.HlsIngest.IngestEndpoints[1].Username,
            SecondaryPassParam: data.HlsIngest.IngestEndpoints[1].Username
        };

        // Adding User/Passord to SSM parameter store.
        let primary = {
            Name: data.HlsIngest.IngestEndpoints[0].Username,
            Type: 'String',
            Value: data.HlsIngest.IngestEndpoints[0].Password,
            Description: 'live-streaming-on-aws MediaPackage Primary Ingest Username'
        };
        await ssm.putParameter(primary).promise();

        let secondary = {
            Name: data.HlsIngest.IngestEndpoints[1].Username,
            Type: 'String',
            Value: data.HlsIngest.IngestEndpoints[1].Password,
            Description: 'live-streaming-on-aws MediaPackage Secondary Ingest Username'
        };
        await ssm.putParameter(secondary).promise();
    } catch (err) {
        console.error(err);
        throw err;
    }
    return responseData;
};


// FEATURE/P15424610:: Function updated to use Async
const deleteChannel = async (ChannelId) => {
    const mediapackage = new AWS.MediaPackage({
        region: process.env.AWS_REGION,
        customUserAgent: process.env.SOLUTION_IDENTIFIER
    });
    try {
        let params = {
            ChannelId: ChannelId
        };
        //Get a list of the endpoints Ids
        let data = await mediapackage.listOriginEndpoints(params).promise();
        //Delete the list of endpoints and wait for the deletes to complete.
        let endPoints = data.OriginEndpoints;
        await Promise.all(endPoints.map(async (endpoint) => {
            params = {
                Id: endpoint.Id
            };
            await mediapackage.deleteOriginEndpoint(params).promise();
        }));
        //Delete the Channel.
        params = {
            Id: ChannelId
        };
        await mediapackage.deleteChannel(params).promise();
    } catch (err) {
        console.error(err);
        throw err;
    }
    return 'success';
};


module.exports = {
    createEndPoint: createEndPoint,
    createChannel: createChannel,
    deleteChannel: deleteChannel
};
