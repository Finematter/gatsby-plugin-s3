"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CACHING_PARAMS = exports.DEFAULT_OPTIONS = exports.CACHE_FILES = void 0;
const path_1 = __importDefault(require("path"));
exports.CACHE_FILES = {
    config: path_1.default.join('.cache', 's3.config.json'),
    params: path_1.default.join('.cache', 's3.params.json'),
    routingRules: path_1.default.join('.cache', 's3.routingRules.json'),
    redirectObjects: path_1.default.join('.cache', 's3.redirectObjects.json'),
};
exports.DEFAULT_OPTIONS = {
    bucketName: '',
    params: {},
    mergeCachingParams: true,
    generateRoutingRules: true,
    // TODO: set this to true by default in the next major version
    generateRedirectObjectsForPermanentRedirects: false,
    generateIndexPageForRedirect: true,
    generateMatchPathRewrites: true,
    removeNonexistentObjects: true,
    retainObjectsPatterns: [],
    enableS3StaticWebsiteHosting: true,
    parallelLimit: 20,
    // the typing requires this for some reason...
    plugins: [],
};
// https://www.gatsbyjs.org/docs/caching/
exports.CACHING_PARAMS = {
    '**/**.html': {
        CacheControl: 'public, max-age=0, must-revalidate',
    },
    'page-data/**/**.json': {
        CacheControl: 'public, max-age=0, must-revalidate',
    },
    '**/static/**': {
        CacheControl: 'public, max-age=31536000, immutable',
    },
    '**/**/!(sw).js': {
        CacheControl: 'public, max-age=31536000, immutable',
    },
    '**/**.css': {
        CacheControl: 'public, max-age=31536000, immutable',
    },
    'sw.js': {
        CacheControl: 'public, max-age=0, must-revalidate',
    },
};
//# sourceMappingURL=constants.js.map