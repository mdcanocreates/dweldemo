// CloudFront Function (cloudfront-js-2.0) — viewer-request on default S3 behavior only.
// Redirects path-based SPA URLs to HashRouter form. Never rewrite /v1, /internal, or /health.
function handler(event) {
  var request = event.request;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return request;
  }

  var uri = request.uri || '/';
  if (
    uri === '/v1' ||
    uri.indexOf('/v1/') === 0 ||
    uri === '/internal' ||
    uri.indexOf('/internal/') === 0 ||
    uri === '/health'
  ) {
    return request;
  }

  // Real static keys (including missing assets) keep their path → real 403/404.
  if (uri.indexOf('.') !== -1) {
    return request;
  }

  if (!isSpaNavigation(uri)) {
    return request;
  }

  var path = uri.length > 1 && uri.charAt(uri.length - 1) === '/' ? uri.slice(0, -1) : uri;
  var qs = buildQueryString(request.querystring);
  return {
    statusCode: 302,
    statusDescription: 'Found',
    headers: {
      location: { value: '/#' + path + qs },
    },
  };
}

function buildQueryString(querystring) {
  if (!querystring) return '';
  var parts = [];
  for (var key in querystring) {
    if (!Object.prototype.hasOwnProperty.call(querystring, key)) continue;
    var item = querystring[key];
    if (item && item.multiValue) {
      for (var i = 0; i < item.multiValue.length; i++) {
        parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(item.multiValue[i].value));
      }
    } else if (item && item.value !== undefined) {
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(item.value));
    }
  }
  return parts.length ? '?' + parts.join('&') : '';
}

function isSpaNavigation(uri) {
  var path = uri.length > 1 && uri.charAt(uri.length - 1) === '/' ? uri.slice(0, -1) : uri;
  var exact = {
    '/discover': 1,
    '/onboard': 1,
    '/screening-choice': 1,
    '/listings': 1,
    '/saved': 1,
    '/partner': 1,
    '/partner/landlord': 1,
    '/partner/broker': 1,
    '/applications': 1,
    '/landlords': 1,
    '/brokers': 1,
    '/calculator': 1,
    '/sign-in': 1,
    '/landlord': 1,
    '/broker': 1,
    '/admin': 1,
    '/faqs': 1,
    '/about': 1,
    '/terms': 1,
    '/privacy': 1,
    '/ccpa': 1,
    '/cashback-terms': 1,
    '/sitemap': 1,
    '/legal/fair-housing': 1,
  };
  if (exact[path]) return true;

  var prefixes = [
    '/listings/',
    '/apply/',
    '/applications/',
    '/partner/',
    '/landlord/',
    '/broker/',
    '/admin/',
    '/legal/',
  ];
  for (var i = 0; i < prefixes.length; i++) {
    if (path.indexOf(prefixes[i]) === 0 && path.length > prefixes[i].length) {
      return true;
    }
  }
  return false;
}
