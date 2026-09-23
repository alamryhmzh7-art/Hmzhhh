/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// If the loader is already loaded, just stop.
if (!self.define) {
  let registry = {};

  // Used for `eval` and `importScripts` where we can't get script URL by other means.
  // In both cases, it's safe to use a global var because those functions are synchronous.
  let nextDefineUri;

  const singleRequire = (uri, parentUri) => {
    uri = new URL(uri + ".js", parentUri).href;
    return registry[uri] || (
      
        new Promise(resolve => {
          if ("document" in self) {
            const script = document.createElement("script");
            script.src = uri;
            script.onload = resolve;
            document.head.appendChild(script);
          } else {
            nextDefineUri = uri;
            importScripts(uri);
            resolve();
          }
        })
      
      .then(() => {
        let promise = registry[uri];
        if (!promise) {
          throw new Error(`Module ${uri} didn’t register its module`);
        }
        return promise;
      })
    );
  };

  self.define = (depsNames, factory) => {
    const uri = nextDefineUri || ("document" in self ? document.currentScript.src : "") || location.href;
    if (registry[uri]) {
      // Module is already loading or loaded.
      return;
    }
    let exports = {};
    const require = depUri => singleRequire(depUri, uri);
    const specialDeps = {
      module: { uri },
      exports,
      require
    };
    registry[uri] = Promise.all(depsNames.map(
      depName => specialDeps[depName] || require(depName)
    )).then(deps => {
      factory(...deps);
      return exports;
    });
  };
}
define(['./workbox-7e5eb42b'], (function (workbox) { 'use strict';

  self.skipWaiting();
  workbox.clientsClaim();
  /**
   * The precacheAndRoute() method efficiently caches and responds to
   * requests for URLs in the manifest.
   * See https://goo.gl/S9QRab
   */
  workbox.precacheAndRoute([{
    "url": "pwa-maskable-512x512.png",
    "revision": "f65009079c8111aaa0835cb6b38f0ee7"
  }, {
    "url": "pwa-512x512.png",
    "revision": "f65009079c8111aaa0835cb6b38f0ee7"
  }, {
    "url": "pwa-192x192.png",
    "revision": "aaab299ef62e547196ecc33315d861d3"
  }, {
    "url": "index.html",
    "revision": "9c09906450279e03a63c41620fbc3084"
  }, {
    "url": "icon.png",
    "revision": "f65009079c8111aaa0835cb6b38f0ee7"
  }, {
    "url": "favicon.ico",
    "revision": "9142544624e00e5e20e46b69d7d82e6b"
  }, {
    "url": "apple-touch-icon.png",
    "revision": "01e7e8e0920a89f7b786844843bec3bc"
  }, {
    "url": "assets/vendor-ui-Cnn331WX.js",
    "revision": null
  }, {
    "url": "assets/vendor-pdf-Y-mjT2v4.js",
    "revision": null
  }, {
    "url": "assets/vendor-charts-DGu4ljDG.js",
    "revision": null
  }, {
    "url": "assets/vendor-capacitor-epEFswTc.js",
    "revision": null
  }, {
    "url": "assets/vendor-Bm16xqZs.js",
    "revision": null
  }, {
    "url": "assets/index-Dr1z7yOM.js",
    "revision": null
  }, {
    "url": "assets/index-CTorGHrz.css",
    "revision": null
  }, {
    "url": "apple-touch-icon.png",
    "revision": "01e7e8e0920a89f7b786844843bec3bc"
  }, {
    "url": "favicon.ico",
    "revision": "9142544624e00e5e20e46b69d7d82e6b"
  }, {
    "url": "icon.png",
    "revision": "f65009079c8111aaa0835cb6b38f0ee7"
  }, {
    "url": "pwa-192x192.png",
    "revision": "aaab299ef62e547196ecc33315d861d3"
  }, {
    "url": "pwa-512x512.png",
    "revision": "f65009079c8111aaa0835cb6b38f0ee7"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "f65009079c8111aaa0835cb6b38f0ee7"
  }, {
    "url": "manifest.webmanifest",
    "revision": "894514ef313214c24c8e86126f8b138f"
  }], {});
  workbox.cleanupOutdatedCaches();
  workbox.registerRoute(new workbox.NavigationRoute(workbox.createHandlerBoundToURL("index.html")));

}));
