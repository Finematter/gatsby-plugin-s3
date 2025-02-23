#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deploy = void 0;
require("@babel/polyfill");
require("fs-posix");
const s3_1 = __importDefault(require("aws-sdk/clients/s3"));
const yargs_1 = __importDefault(require("yargs"));
const constants_1 = require("./constants");
const fs_extra_1 = require("fs-extra");
const klaw_1 = __importDefault(require("klaw"));
const pretty_error_1 = __importDefault(require("pretty-error"));
const stream_to_promise_1 = __importDefault(require("stream-to-promise"));
const ora_1 = __importDefault(require("ora"));
const chalk_1 = __importDefault(require("chalk"));
const path_1 = require("path");
const url_1 = require("url");
const fs_1 = __importDefault(require("fs"));
const util_1 = __importDefault(require("util"));
const minimatch_1 = __importDefault(require("minimatch"));
const mime_1 = __importDefault(require("mime"));
const inquirer_1 = __importDefault(require("inquirer"));
const aws_sdk_1 = require("aws-sdk");
const crypto_1 = require("crypto");
const is_ci_1 = __importDefault(require("is-ci"));
const util_2 = require("./util");
const async_1 = require("async");
const proxy_agent_1 = __importDefault(require("proxy-agent"));
const pe = new pretty_error_1.default();
const OBJECTS_TO_REMOVE_PER_REQUEST = 1000;
const promisifiedParallelLimit = util_1.default.promisify(async_1.parallelLimit);
const guessRegion = (s3, constraint) => { var _a; return (_a = constraint !== null && constraint !== void 0 ? constraint : s3.config.region) !== null && _a !== void 0 ? _a : aws_sdk_1.config.region; };
const getBucketInfo = async (config, s3) => {
    try {
        const { $response } = await s3.getBucketLocation({ Bucket: config.bucketName }).promise();
        const responseData = $response.data; // Fix type to be possibly `null` instead of possibly `void`
        const detectedRegion = guessRegion(s3, responseData === null || responseData === void 0 ? void 0 : responseData.LocationConstraint);
        return {
            exists: true,
            region: detectedRegion,
        };
    }
    catch (ex) {
        if (ex.code === 'NoSuchBucket') {
            return {
                exists: false,
                region: guessRegion(s3),
            };
        }
        throw ex;
    }
};
const getParams = (path, params) => {
    let returned = {};
    for (const key of Object.keys(params)) {
        if (minimatch_1.default(path, key)) {
            returned = Object.assign(Object.assign({}, returned), params[key]);
        }
    }
    return returned;
};
const listAllObjects = async (s3, bucketName, bucketPrefix) => {
    const list = [];
    let token;
    do {
        const response = await s3
            .listObjectsV2({
            Bucket: bucketName,
            ContinuationToken: token,
            Prefix: bucketPrefix,
        })
            .promise();
        if (response.Contents) {
            list.push(...response.Contents);
        }
        token = response.NextContinuationToken;
    } while (token);
    return list;
};
const createSafeS3Key = (key) => {
    if (path_1.sep === '\\') {
        return key.replace(/\\/g, '/');
    }
    return key;
};
exports.deploy = async ({ yes, bucket, userAgent } = {}) => {
    var _a;
    const spinner = ora_1.default({ text: 'Retrieving bucket info...', color: 'magenta', stream: process.stdout }).start();
    let dontPrompt = yes;
    const uploadQueue = [];
    try {
        const config = await fs_extra_1.readJson(constants_1.CACHE_FILES.config);
        const params = await fs_extra_1.readJson(constants_1.CACHE_FILES.params);
        const routingRules = await fs_extra_1.readJson(constants_1.CACHE_FILES.routingRules);
        const redirectObjects = fs_1.default.existsSync(constants_1.CACHE_FILES.redirectObjects)
            ? await fs_extra_1.readJson(constants_1.CACHE_FILES.redirectObjects)
            : [];
        // Override the bucket name if it is set via command line
        if (bucket) {
            config.bucketName = bucket;
        }
        let httpOptions = {};
        if (process.env.HTTP_PROXY) {
            httpOptions = {
                agent: proxy_agent_1.default(process.env.HTTP_PROXY),
            };
        }
        httpOptions = Object.assign({ agent: process.env.HTTP_PROXY ? proxy_agent_1.default(process.env.HTTP_PROXY) : undefined, timeout: config.timeout, connectTimeout: config.connectTimeout }, httpOptions);
        const s3 = new s3_1.default({
            region: config.region,
            endpoint: config.customAwsEndpointHostname,
            customUserAgent: userAgent !== null && userAgent !== void 0 ? userAgent : '',
            httpOptions,
            logger: config.verbose ? console : undefined,
            retryDelayOptions: {
                customBackoff: process.env.fixedRetryDelay ? () => Number(config.fixedRetryDelay) : undefined,
            },
        });
        const { exists, region } = await getBucketInfo(config, s3);
        if (is_ci_1.default && !dontPrompt) {
            dontPrompt = true;
        }
        if (!dontPrompt) {
            spinner.stop();
            console.log(chalk_1.default `
    {underline Please review the following:} ({dim pass -y next time to skip this})

    Deploying to bucket: {cyan.bold ${config.bucketName}}
    In region: {yellow.bold ${region !== null && region !== void 0 ? region : 'UNKNOWN!'}}
    Gatsby will: ${!exists
                ? chalk_1.default `{bold.greenBright CREATE}`
                : chalk_1.default `{bold.blueBright UPDATE} {dim (any existing website configuration will be overwritten!)}`}
`);
            const { confirm } = await inquirer_1.default.prompt([
                {
                    message: 'OK?',
                    name: 'confirm',
                    type: 'confirm',
                },
            ]);
            if (!confirm) {
                throw new Error('User aborted!');
            }
            spinner.start();
        }
        spinner.text = 'Configuring bucket...';
        spinner.color = 'yellow';
        if (!exists) {
            const createParams = {
                Bucket: config.bucketName,
                ACL: config.acl === null ? undefined : (_a = config.acl) !== null && _a !== void 0 ? _a : 'public-read',
            };
            if (config.region) {
                createParams.CreateBucketConfiguration = {
                    LocationConstraint: config.region,
                };
            }
            await s3.createBucket(createParams).promise();
            if (config.enableS3StaticWebsiteHosting) {
                const publicBlockConfig = {
                    Bucket: config.bucketName,
                };
                await s3.deletePublicAccessBlock(publicBlockConfig).promise();
            }
        }
        if (config.enableS3StaticWebsiteHosting) {
            const websiteConfig = {
                Bucket: config.bucketName,
                WebsiteConfiguration: {
                    IndexDocument: {
                        Suffix: 'index.html',
                    },
                    ErrorDocument: {
                        Key: '404.html',
                    },
                },
            };
            if (routingRules.length) {
                websiteConfig.WebsiteConfiguration.RoutingRules = routingRules;
            }
            await s3.putBucketWebsite(websiteConfig).promise();
        }
        spinner.text = 'Listing objects...';
        spinner.color = 'green';
        const objects = await listAllObjects(s3, config.bucketName, config.bucketPrefix);
        const keyToETagMap = objects.reduce((acc, curr) => {
            if (curr.Key && curr.ETag) {
                acc[curr.Key] = curr.ETag;
            }
            return acc;
        }, {});
        spinner.color = 'cyan';
        spinner.text = 'Syncing...';
        const publicDir = path_1.resolve('./public');
        const stream = klaw_1.default(publicDir);
        const isKeyInUse = {};
        stream.on('data', ({ path, stats }) => {
            if (!stats.isFile()) {
                return;
            }
            uploadQueue.push(async_1.asyncify(async () => {
                var _a, _b;
                let key = createSafeS3Key(path_1.relative(publicDir, path));
                if (config.bucketPrefix) {
                    key = `${config.bucketPrefix}/${key}`;
                }
                try {
                    const upload = new s3_1.default.ManagedUpload({
                        service: s3,
                        params: Object.assign({ Bucket: config.bucketName, Key: key, Body: fs_1.default.createReadStream(path), ACL: config.acl === null ? undefined : (_a = config.acl) !== null && _a !== void 0 ? _a : 'public-read', ContentType: (_b = mime_1.default.getType(path)) !== null && _b !== void 0 ? _b : 'application/octet-stream' }, getParams(key, params)),
                    });
                    upload.on('httpUploadProgress', evt => {
                        spinner.text = chalk_1.default `Syncing...
{dim   Uploading {cyan ${key}} ${evt.loaded.toString()}/${evt.total.toString()}}`;
                    });
                    await upload.promise();
                    spinner.text = chalk_1.default `Syncing...\n{dim   Uploaded {cyan ${key}}}`;
                }
                catch (ex) {
                    console.error(ex);
                    process.exit(1);
                }
            }));
        });
        const base = config.protocol && config.hostname ? `${config.protocol}://${config.hostname}` : null;
        redirectObjects.forEach(redirect => uploadQueue.push(async_1.asyncify(async () => {
            var _a;
            const { fromPath, toPath: redirectPath } = redirect;
            const redirectLocation = base ? url_1.resolve(base, redirectPath) : redirectPath;
            let key = util_2.withoutLeadingSlash(fromPath);
            if (key.endsWith('/')) {
                key = path_1.join(key, 'index.html');
            }
            key = createSafeS3Key(key);
            if (config.bucketPrefix) {
                key = util_2.withoutLeadingSlash(`${config.bucketPrefix}/${key}`);
            }
            const tag = `"${crypto_1.createHash('md5')
                .update(redirectLocation)
                .digest('hex')}"`;
            const objectUnchanged = keyToETagMap[key] === tag;
            isKeyInUse[key] = true;
            if (objectUnchanged) {
                // object with exact hash already exists, abort.
                return;
            }
            try {
                const upload = new s3_1.default.ManagedUpload({
                    service: s3,
                    params: Object.assign({ Bucket: config.bucketName, Key: key, Body: redirectLocation, ACL: config.acl === null ? undefined : (_a = config.acl) !== null && _a !== void 0 ? _a : 'public-read', ContentType: 'application/octet-stream', WebsiteRedirectLocation: redirectLocation }, getParams(key, params)),
                });
                await upload.promise();
                spinner.text = chalk_1.default `Syncing...
{dim   Created Redirect {cyan ${key}} => {cyan ${redirectLocation}}}\n`;
            }
            catch (ex) {
                spinner.fail(chalk_1.default `Upload failure for object {cyan ${key}}`);
                console.error(pe.render(ex));
                process.exit(1);
            }
        })));
        await stream_to_promise_1.default(stream);
        await promisifiedParallelLimit(uploadQueue, config.parallelLimit);
        if (config.removeNonexistentObjects) {
            const objectsToRemove = objects
                .map(obj => ({ Key: obj.Key }))
                .filter(obj => {
                var _a;
                if (!obj.Key || isKeyInUse[obj.Key])
                    return false;
                for (const glob of (_a = config.retainObjectsPatterns) !== null && _a !== void 0 ? _a : []) {
                    if (minimatch_1.default(obj.Key, glob)) {
                        return false;
                    }
                }
                return true;
            });
            for (let i = 0; i < objectsToRemove.length; i += OBJECTS_TO_REMOVE_PER_REQUEST) {
                const objectsToRemoveInThisRequest = objectsToRemove.slice(i, i + OBJECTS_TO_REMOVE_PER_REQUEST);
                spinner.text = `Removing objects ${i + 1} to ${i + objectsToRemoveInThisRequest.length} of ${objectsToRemove.length}`;
                await s3
                    .deleteObjects({
                    Bucket: config.bucketName,
                    Delete: {
                        Objects: objectsToRemoveInThisRequest,
                        Quiet: true,
                    },
                })
                    .promise();
            }
        }
        spinner.succeed('Synced.');
        if (config.enableS3StaticWebsiteHosting) {
            const s3WebsiteDomain = util_2.getS3WebsiteDomainUrl(region !== null && region !== void 0 ? region : 'us-east-1');
            console.log(chalk_1.default `
            {bold Your website is online at:}
            {blue.underline http://${config.bucketName}.${s3WebsiteDomain}}
            `);
        }
        else {
            console.log(chalk_1.default `
            {bold Your website has now been published to:}
            {blue.underline ${config.bucketName}}
            `);
        }
    }
    catch (ex) {
        spinner.fail('Failed.');
        console.error(pe.render(ex));
        process.exit(1);
    }
};
yargs_1.default
    .command(['deploy', '$0'], "Deploy bucket. If it doesn't exist, it will be created. Otherwise, it will be updated.", args => args
    .option('yes', {
    alias: 'y',
    describe: 'Skip confirmation prompt',
    boolean: true,
})
    .option('bucket', {
    alias: 'b',
    describe: 'Bucket name (if you wish to override default bucket name)',
})
    .option('userAgent', {
    describe: 'Allow appending custom text to the User Agent string (Used in automated tests)',
}), exports.deploy)
    .wrap(yargs_1.default.terminalWidth())
    .demandCommand(1, `Pass --help to see all available commands and options.`)
    .strict()
    .showHelpOnFail(true)
    .recommendCommands()
    .parse(process.argv.slice(2));
//# sourceMappingURL=bin.js.map