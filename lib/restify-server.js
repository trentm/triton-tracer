//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Copyright (c) 2016, Joyent, Inc.
//

var assert = require('assert-plus');
var Tracer = require('opentracing');

var TritonConstants = require('./ot-constants');
var TritonTracer = require('./ot-tracer-imp');

var MICROS_PER_SECOND = 1000000;
var NS_PER_MICROS = 1000;

function initGlobalTracer(options) {
    assert.ok(!Tracer._imp, 'Tracer._imp already defined'); // already init'ed!

    Tracer.initGlobalTracer(new TritonTracer(options));
}

function initRestifyServer(server) {
    assert.object(server, 'server');

    // We do server.use instead of server.on('request', ...) because the
    // 'request' event is emitted before we've got the route.name.
    server.use(function _beginReqTracing(req, res, next) {
        var extractedCtx;
        var fields = {};
        var span;
        var spanName = (req.route ? req.route.name : 'http_request');

        extractedCtx = Tracer.extract(TritonConstants.RESTIFY_REQ_CARRIER, req);
        if (extractedCtx) {
            fields.continuationOf = extractedCtx;
        }

        // start/join a span
        span = Tracer.startSpan(spanName, fields);
        span.addTags({
            'http.method': req.method,
            'http.url': req.url
        });
        span.log({event: 'server-request'});

        // attach the span to the req object so we can use it elsewhere.
        req.tritonTraceSpan = span;

        next();
    });

    // After a request we want to log the response and finish the span.
    server.on('after', function _endReqTracing(req, res /* , route, err */) {
        var span;
        var timers = {};

        if (req.hasOwnProperty('tritonTraceSpan')) {
            span = req.tritonTraceSpan;

            // Same logic as restify/lib/plugins/audit.js, times will be in
            // microseconds.
            (req.timers || []).forEach(function _eachTimer(time) {
                var t = time.time;
                var _t = Math.floor((MICROS_PER_SECOND * t[0])
                    + (t[1] / NS_PER_MICROS));

                timers[time.name] = _t;
            });

            span.addTags({
                'http.status_code': res.statusCode,
                'restify.timers': timers
            });
            span.log({event: 'server-response'});
            span.finish();
        }
    });
}

module.exports = {
    initGlobalTracer: initGlobalTracer,
    initServer: initRestifyServer
};