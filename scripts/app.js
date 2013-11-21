RAML.Inspector = (function() {
  'use strict';

  var exports = {};

  var METHOD_ORDERING = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT'];

  function extendMethod(method, securitySchemes) {
    securitySchemes = securitySchemes || [];

    method.securitySchemes = function() {
      var securedBy, selectedSchemes = {};
      securedBy = (this.securedBy || []).filter(function(name) {
        return name !== null && typeof name !== 'object';
      });

      securitySchemes.forEach(function(scheme) {
        securedBy.forEach(function(name) {
          if (scheme[name]) {
            selectedSchemes[name] = scheme[name];
          }
        });
      });

      return selectedSchemes;
    };

    method.allowsAnonymousAccess = function() {
      return (this.securedBy || []).some(function(name) { return name === null; });
    };
  }

  function extractResources(basePathSegments, api, securitySchemes) {
    var resources = [], apiResources = api.resources || [];

    apiResources.forEach(function(resource) {
      var resourcePathSegments = basePathSegments.concat(RAML.Client.createPathSegment(resource));
      var overview = exports.resourceOverviewSource(resourcePathSegments, resource);

      overview.methods.forEach(function(method) {
        extendMethod(method, securitySchemes);
      });

      resources.push(overview);

      if (resource.resources) {
        var extracted = extractResources(resourcePathSegments, resource, securitySchemes);
        extracted.forEach(function(resource) {
          resources.push(resource);
        });
      }
    });

    return resources;
  }

  function groupResources(resources) {
    var currentPrefix, resourceGroups = [];

    (resources || []).forEach(function(resource) {
      if (resource.pathSegments[0].toString().indexOf(currentPrefix) !== 0) {
        currentPrefix = resource.pathSegments[0].toString();
        resourceGroups.push([]);
      }
      resourceGroups[resourceGroups.length-1].push(resource);
    });

    return resourceGroups;
  }

  exports.resourceOverviewSource = function(pathSegments, resource) {

    resource.traits = resource.is;
    delete resource.is;
    resource.resourceType = resource.type;
    delete resource.type;
    resource.pathSegments = pathSegments;

    resource.methods = (resource.methods || []);

    resource.methods.sort(function(a, b) {
      var aOrder = METHOD_ORDERING.indexOf(a.method.toUpperCase());
      var bOrder = METHOD_ORDERING.indexOf(b.method.toUpperCase());

      return aOrder > bOrder ? 1 : -1;
    });

    return resource;
  };

  exports.create = function(api) {
    if (api.baseUri) {
      api.baseUri = RAML.Client.createBaseUri(api);
    }

    api.resources = extractResources([], api, api.securitySchemes);
    api.resourceGroups = groupResources(api.resources);

    return api;
  };

  return exports;
})();

'use strict';

(function() {
  var Client = function(configuration) {
    this.baseUri = configuration.getBaseUri();
  };

  function createConfiguration(parsed) {
    var config = {
      baseUriParameters: {}
    };

    return {
      baseUriParameters: function(baseUriParameters) {
        config.baseUriParameters = baseUriParameters || {};
      },

      getBaseUri: function() {
        var template = RAML.Client.createBaseUri(parsed);
        config.baseUriParameters.version = parsed.version;

        return template.render(config.baseUriParameters);
      }
    };
  }

  RAML.Client = {
    create: function(parsed, configure) {
      var configuration = createConfiguration(parsed);

      if (configure) {
        configure(configuration);
      }

      return new Client(configuration);
    },

    createBaseUri: function(rootRAML) {
      var baseUri = rootRAML.baseUri.toString();
      return new RAML.Client.ParameterizedString(baseUri, rootRAML.baseUriParameters, { parameterValues: {version: rootRAML.version} });
    },

    createPathSegment: function(resourceRAML) {
      return new RAML.Client.ParameterizedString(resourceRAML.relativeUri, resourceRAML.uriParameters);
    }
  };
})();

(function() {
  'use strict';

  RAML.Client.AuthStrategies = {
    for: function(scheme, credentials) {
      if (!scheme) {
        return RAML.Client.AuthStrategies.anonymous();
      }

      switch(scheme.type) {
      case 'Basic Authentication':
        return new RAML.Client.AuthStrategies.Basic(scheme, credentials);
      case 'OAuth 2.0':
        return new RAML.Client.AuthStrategies.Oauth2(scheme, credentials);
      default:
        throw new Error('Unknown authentication strategy: ' + scheme.type);
      }
    }
  };
})();

'use strict';

(function() {
  var NO_OP_TOKEN = {
    sign: function() {}
  };

  var Anonymous = function() {};

  Anonymous.prototype.authenticate = function() {
    return {
      then: function(success) { success(NO_OP_TOKEN); }
    };
  };

  var anonymous = new Anonymous();

  RAML.Client.AuthStrategies.Anonymous = Anonymous;
  RAML.Client.AuthStrategies.anonymous = function() {
    return anonymous;
  };
})();

/* jshint bitwise: false */

'use strict';

RAML.Client.AuthStrategies.base64 = (function () {
  var keyStr = 'ABCDEFGHIJKLMNOP' +
    'QRSTUVWXYZabcdef' +
    'ghijklmnopqrstuv' +
    'wxyz0123456789+/' +
    '=';

  return {
    encode: function (input) {
      var output = '';
      var chr1, chr2, chr3 = '';
      var enc1, enc2, enc3, enc4 = '';
      var i = 0;

      do {
        chr1 = input.charCodeAt(i++);
        chr2 = input.charCodeAt(i++);
        chr3 = input.charCodeAt(i++);

        enc1 = chr1 >> 2;
        enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
        enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
        enc4 = chr3 & 63;

        if (isNaN(chr2)) {
          enc3 = enc4 = 64;
        } else if (isNaN(chr3)) {
          enc4 = 64;
        }

        output = output +
        keyStr.charAt(enc1) +
        keyStr.charAt(enc2) +
        keyStr.charAt(enc3) +
        keyStr.charAt(enc4);
        chr1 = chr2 = chr3 = '';
        enc1 = enc2 = enc3 = enc4 = '';
      } while (i < input.length);

      return output;
    },

    decode: function (input) {
      var output = '';
      var chr1, chr2, chr3 = '';
      var enc1, enc2, enc3, enc4 = '';
      var i = 0;

      // remove all characters that are not A-Z, a-z, 0-9, +, /, or =
      var base64test = /[^A-Za-z0-9\+\/\=]/g;
      if (base64test.exec(input)) {
        window.alert('There were invalid base64 characters in the input text.\n' +
          'Valid base64 characters are A-Z, a-z, 0-9, '+', \'/\',and \'=\'\n' +
          'Expect errors in decoding.');
      }
      input = input.replace(/[^A-Za-z0-9\+\/\=]/g, '');

      do {
        enc1 = keyStr.indexOf(input.charAt(i++));
        enc2 = keyStr.indexOf(input.charAt(i++));
        enc3 = keyStr.indexOf(input.charAt(i++));
        enc4 = keyStr.indexOf(input.charAt(i++));

        chr1 = (enc1 << 2) | (enc2 >> 4);
        chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
        chr3 = ((enc3 & 3) << 6) | enc4;

        output = output + String.fromCharCode(chr1);

        if (enc3 !== 64) {
          output = output + String.fromCharCode(chr2);
        }
        if (enc4 !== 64) {
          output = output + String.fromCharCode(chr3);
        }

        chr1 = chr2 = chr3 = '';
        enc1 = enc2 = enc3 = enc4 = '';

      } while (i < input.length);

      return output;
    }
  };
})();

'use strict';

(function() {
  var base64 = RAML.Client.AuthStrategies.base64;

  var Basic = function(scheme, credentials) {
    this.token = new Basic.Token(credentials);
  };

  Basic.prototype.authenticate = function() {
    var token = this.token;

    return {
      then: function(success) { success(token); }
    };
  };

  Basic.Token = function(credentials) {
    this.encoded = base64.encode(credentials.username + ':' + credentials.password);
  };

  Basic.Token.prototype.sign = function(request) {
    request.header('Authorization', 'Basic ' + this.encoded);
  };

  RAML.Client.AuthStrategies.Basic = Basic;
})();

(function() {
  /* jshint camelcase: false */
  'use strict';

  function tokenConstructorFor(scheme) {
    var describedBy = scheme.describedBy || {},
        queryParameters = describedBy.queryParameters || {};

    if (queryParameters.access_token) {
      return Oauth2.QueryParameterToken;
    }

    return Oauth2.HeaderToken;
  }

  var WINDOW_NAME = 'raml-console-oauth2';

  var Oauth2 = function(scheme, credentials) {
    this.scheme = scheme;
    this.credentialsManager = Oauth2.credentialsManager(credentials);
  };

  Oauth2.prototype.authenticate = function() {
    var authorizationRequest = Oauth2.authorizationRequest(this.scheme, this.credentialsManager);
    var accessTokenRequest = Oauth2.accessTokenRequest(this.scheme, this.credentialsManager);

    return authorizationRequest.then(accessTokenRequest);
  };

  Oauth2.credentialsManager = function(credentials) {
    return {
      authorizationUrl : function(baseUrl) {
        return baseUrl +
          '?client_id=' + credentials.clientId +
          '&response_type=code' +
          '&redirect_uri=' + RAML.Settings.oauth2RedirectUri;
      },

      accessTokenParameters: function(code) {
        return {
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          code: code,
          grant_type: 'authorization_code',
          redirect_uri: RAML.Settings.oauth2RedirectUri
        };
      }
    };
  };

  Oauth2.authorizationRequest = function(scheme, credentialsManager) {
    var settings = scheme.settings;
    var authorizationUrl = credentialsManager.authorizationUrl(settings.authorizationUri);
    window.open(authorizationUrl, WINDOW_NAME);

    var deferred = $.Deferred();
    window.RAML.authorizationSuccess = function(code) { deferred.resolve(code); };
    return deferred.promise();
  };

  Oauth2.accessTokenRequest = function(scheme, credentialsManager) {
    var settings = scheme.settings;
    var TokenConstructor = tokenConstructorFor(scheme);
    return function(code) {
      var url = settings.accessTokenUri;
      if (RAML.Settings.proxy) {
        url = RAML.Settings.proxy + url;
      }

      var requestOptions = {
        url: url,
        type: 'post',
        data: credentialsManager.accessTokenParameters(code)
      };

      var createToken = function(data) {
        return new TokenConstructor(data.access_token);
      };
      return $.ajax(requestOptions).then(createToken);
    };
  };

  Oauth2.QueryParameterToken = function(token) {
    this.accessToken = token;
  };

  Oauth2.QueryParameterToken.prototype.sign = function(request) {
    request.queryParam('access_token', this.accessToken);
  };

  Oauth2.HeaderToken = function(token) {
    this.accessToken = token;
  };

  Oauth2.HeaderToken.prototype.sign = function(request) {
    request.header('Authorization', 'Bearer ' + this.accessToken);
  };

  RAML.Client.AuthStrategies.Oauth2 = Oauth2;
})();

(function() {
  'use strict';

  var templateMatcher = /\{([^}]*)\}/g;

  function tokenize(template) {
    var tokens = template.split(templateMatcher);

    return tokens.filter(function(token) {
      return token.length > 0;
    });
  }

  function rendererFor(template, uriParameters) {
    var requiredParameters = Object.keys(uriParameters || {}).filter(function(name) {
      return uriParameters[name].required;
    });

    return function renderer(context) {
      context = context || {};

      requiredParameters.forEach(function(name) {
        if (!context[name]) {
          throw new Error('Missing required uri parameter: ' + name);
        }
      });

      var templated = template.replace(templateMatcher, function(match, parameterName) {
        return context[parameterName] || '';
      });

      return templated;
    };
  }

  RAML.Client.ParameterizedString = function(template, uriParameters, options) {
    options = options || {parameterValues: {} };
    template = template.replace(templateMatcher, function(match, parameterName) {
      if (options.parameterValues[parameterName]) {
        return options.parameterValues[parameterName];
      }
      return '{' + parameterName + '}';
    });

    this.parameters = uriParameters;
    this.tokens = tokenize(template);
    this.render = rendererFor(template, uriParameters);
    this.toString = function() { return template; };
  };
})();

(function() {
  'use strict';

  RAML.Client.PathBuilder = {
    create: function(pathSegments) {
      return function pathBuilder(contexts) {
        contexts = contexts || [];

        return pathSegments.map(function(pathSegment, index) {
          return pathSegment.render(contexts[index]);
        }).join('');
      };
    }
  };
})();

(function() {
  'use strict';

  var CONTENT_TYPE = 'content-type';
  var FORM_DATA = 'multipart/form-data';

  var RequestDsl = function(options) {
    var rawData;
    var isMultipartRequest;

    this.data = function(data) {
      rawData = data;
    };

    this.queryParam = function(name, value) {
      rawData = rawData || {};
      rawData[name] = value;
    };

    this.header = function(name, value) {
      options.headers = options.headers || {};

      if (name.toLowerCase() === CONTENT_TYPE) {
        if (value === FORM_DATA) {
          isMultipartRequest = true;
          return;
        } else {
          isMultipartRequest = false;
          options.contentType = value;
        }
      }

      options.headers[name] = value;
    };

    this.headers = function(headers) {
      options.headers = {};
      isMultipartRequest = false;
      options.contentType = false;

      for (var name in headers) {
        this.header(name, headers[name]);
      }
    };

    this.toOptions = function() {
      if (rawData) {
        if (isMultipartRequest) {
          var data = new FormData();

          for (var key in rawData) {
            data.append(key, rawData[key]);
          }

          options.processData = false;
          options.data = data;
        } else {
          options.processData = true;
          options.data = rawData;
        }
      }

      return options;
    };
  };

  RAML.Client.Request = {
    create: function(url, method) {
      var request = {};
      RequestDsl.call(request, { url: url, type: method, contentType: false });

      return request;
    }
  };
})();

(function() {
  'use strict';

  // number regular expressions from http://yaml.org/spec/1.2/spec.html#id2804092

  var RFC1123 = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

  var VALIDATIONS = {
    required: function(value) { return value !== null && value !== undefined && value !== ''; },
    boolean: function(value) { return value === 'true' || value === 'false' || value === ''; },
    enum: function(enumeration) {
      return function(value) {
        return value === '' || enumeration.some(function(item) { return item === value; });
      };
    },
    integer: function(value) { return value === '' || !!/^-?(0|[1-9][0-9]*)$/.exec(value); },
    number: function(value) { return value === '' || !!/^-?(0|[1-9][0-9]*)(\.[0-9]*)?([eE][-+]?[0-9]+)?$/.exec(value); },
    minimum: function(minimum) {
      return function(value) {
        return value === '' || value >= minimum;
      };
    },
    maximum: function(maximum) {
      return function(value) {
        return value === '' || value <= maximum;
      };
    },
    minLength: function(minimum) {
      return function(value) {
        return value === '' || value.length >= minimum;
      };
    },
    maxLength: function(maximum) {
      return function(value) {
        return value === '' || value.length <= maximum;
      };
    },
    pattern: function(pattern) {
      var regex = new RegExp(pattern);

      return function(value) {
        return value === '' || !!regex.exec(value);
      };
    },
    date: function(value) { return value === '' || !!RFC1123.exec(value); }
  };

  function baseValidations(definition) {
    var validations = {};

    if (definition.required) {
      validations.required = VALIDATIONS.required;
    }

    return validations;
  }

  function numberValidations(validations, definition) {
    if (definition.minimum) {
      validations.minimum = VALIDATIONS.minimum(definition.minimum);
    }

    if (definition.maximum) {
      validations.maximum = VALIDATIONS.maximum(definition.maximum);
    }
  }

  // function copyValidations(validations, types) {
  //   Object.keys(types).forEach(function(type) {
  //     validations[type] = VALIDATIONS[type](types[type]);
  //   });
  // }

  var VALIDATIONS_FOR_TYPE = {
    string: function(definition) {
      var validations = baseValidations(definition);
      if (definition.enum) {
        validations.enum = VALIDATIONS.enum(definition.enum);
      }
      if (definition.minLength) {
        validations.minLength = VALIDATIONS.minLength(definition.minLength);
      }
      if (definition.maxLength) {
        validations.maxLength = VALIDATIONS.maxLength(definition.maxLength);
      }
      if (definition.pattern) {
        validations.pattern = VALIDATIONS.pattern(definition.pattern);
      }
      return validations;
    },

    integer: function(definition) {
      var validations = baseValidations(definition);
      validations.integer = VALIDATIONS.integer;
      numberValidations(validations, definition);
      return validations;
    },

    number: function(definition) {
      var validations = baseValidations(definition);
      validations.number = VALIDATIONS.number;
      numberValidations(validations, definition);
      return validations;
    },

    boolean: function(definition) {
      var validations = baseValidations(definition);
      validations.boolean = VALIDATIONS.boolean;
      return validations;
    },

    date: function(definition) {
      var validations = baseValidations(definition);
      validations.date = VALIDATIONS.date;
      return validations;
    }
  };

  function Validator(validations) {
    this.validations = validations;
  }

  Validator.prototype.validate = function(value) {
    var errors;

    for (var validation in this.validations) {
      if (!this.validations[validation](value)) {
        errors = errors || [];
        errors.push(validation);
      }
    }

    return errors;
  };

  Validator.from = function(definition) {
    if (!definition) {
      throw new Error('definition is required!');
    }

    var validations;

    if (VALIDATIONS_FOR_TYPE[definition.type]) {
      validations = VALIDATIONS_FOR_TYPE[definition.type](definition);
    } else {
      validations = {};
    }

    return new Validator(validations);
  };

  RAML.Client.Validator = Validator;
})();

'use strict';

(function() {
  RAML.Controllers = {};
})();

(function() {
  'use strict';

  function isEmpty(object) {
    return Object.keys(object || {}).length === 0;
  }

  var FORM_MIME_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data'];

  function hasFormParameters(method) {
    return FORM_MIME_TYPES.some(function(type) {
      return method.body && method.body[type] && !isEmpty(method.body[type].formParameters);
    });
  }

  var controller = function($scope) {
    $scope.documentation = this;

    this.method = $scope.method;

    var hasParameters = !!($scope.resource.uriParameters || this.method.queryParameters ||
      this.method.headers || hasFormParameters(this.method));

    this.hasRequestDocumentation = hasParameters || !isEmpty(this.method.body);
    this.hasResponseDocumentation = !isEmpty(this.method.responses);
    this.hasTryIt = !!$scope.api.baseUri;
  };

  controller.prototype.traits = function() {
    return (this.method.is || []);
  };

  RAML.Controllers.Documentation = controller;
})();

'use strict';

(function() {
  var controller = function($scope) {
    $scope.namedParametersDocumentation = this;
  };

  controller.prototype.constraints = function(parameter) {
    var result = '';

    if (parameter.required) {
      result += 'required, ';
    }

    if (parameter.enum) {
      result += 'one of (' + parameter.enum.join(', ') + ')';
    } else {
      result += parameter.type;
    }

    if (parameter.pattern) {
      result += ' matching ' + parameter.pattern;
    }

    if (parameter.minLength && parameter.maxLength) {
      result += ', ' + parameter.minLength + '-' + parameter.maxLength + ' characters';
    } else if (parameter.minLength && !parameter.maxLength) {
      result += ', at least ' + parameter.minLength + ' characters';
    } else if (parameter.maxLength && !parameter.minLength) {
      result += ', at most ' + parameter.maxLength + ' characters';
    }


    if (parameter.minimum && parameter.maximum) {
      result += ' between ' + parameter.minimum + '-' + parameter.maximum;
    } else if (parameter.minimum && !parameter.maximum) {
      result += ' ≥ ' + parameter.minimum;
    } else if (parameter.maximum && !parameter.minimum) {
      result += ' ≤ ' + parameter.maximum;
    }

    if (parameter.repeat) {
      result += ', repeatable';
    }

    if (parameter.default) {
      result += ', default: ' + parameter.default;
    }

    return result;
  };

  RAML.Controllers.NamedParametersDocumentation = controller;
})();

'use strict';

(function() {
  function isEmpty(object) {
    return Object.keys(object || {}).length === 0;
  }

  var controller = function($scope) {
    var method = $scope.method;
    var resource = $scope.resource;
    var parameterGroups = [];

    if (!isEmpty(method.headers)) {
      parameterGroups.push(['Headers', method.headers]);
    }
    if (!isEmpty(resource.uriParameters)) {
      parameterGroups.push(['URI Parameters', resource.uriParameters]);
    }
    if (!isEmpty(method.queryParameters)) {
      parameterGroups.push(['Query Parameters', method.queryParameters]);
    }

    if (method.body) {
      var normalForm = method.body['application/x-www-form-urlencoded'];
      var multipartForm = method.body['multipart/form-data'];

      if (normalForm && !isEmpty(normalForm.formParameters)) {
        parameterGroups.push(['Form Parameters', normalForm.formParameters]);
      }
      if (multipartForm && !isEmpty(multipartForm.formParameters)) {
        parameterGroups.push(['Multipart Form Parameters', multipartForm.formParameters]);
      }
    }

    $scope.parameterGroups = parameterGroups;
  };

  RAML.Controllers.Parameters = controller;
})();

(function() {
  'use strict';

  var controller = function($scope, $attrs, ramlParserWrapper) {
    $scope.ramlConsole = this;

    if ($attrs.hasOwnProperty('withRootDocumentation')) {
      this.withRootDocumentation = true;
    }

    if ($scope.src) {
      ramlParserWrapper.load($scope.src);
    }

    this.keychain = {};
  };

  controller.prototype.gotoView = function(view) {
    this.view = view;
  };

  controller.prototype.showRootDocumentation = function() {
    return this.withRootDocumentation && this.api && this.api.documentation && this.api.documentation.length > 0;
  };

  RAML.Controllers.RAMLConsole = controller;
})();

'use strict';

(function() {

  var controller = function($scope) {
    this.tabs = $scope.tabs = [];
    $scope.tabset = this;
  };

  controller.prototype.select = function(tab) {
    if (tab.disabled) {
      return;
    }
    this.tabs.forEach(function(tab) {
      tab.active = false;
    });
    tab.active = true;
  };

  controller.prototype.addTab = function(tab) {
    if (this.tabs.every(function(tab) { return tab.disabled; }) || tab.active) {
      this.select(tab);
    }
    this.tabs.push(tab);
  };

  RAML.Controllers.tabset = controller;

})();

'use strict';

(function() {
  function isEmpty(object) {
    if (object) {
      return Object.keys(filterEmpty(object)).length === 0;
    } else {
      return true;
    }
  }

  function filterEmpty(object) {
    var copy = {};

    Object.keys(object).forEach(function(key) {
      if (object[key] && (typeof object[key] !== 'string' || object[key].trim().length > 0)) {
        copy[key] = object[key];
      }
    });

    return copy;
  }

  function parseHeaders(headers) {
    var parsed = {}, key, val, i;

    if (!headers) {
      return parsed;
    }

    headers.split('\n').forEach(function(line) {
      i = line.indexOf(':');
      key = line.substr(0, i).trim().toLowerCase();
      val = line.substr(i + 1).trim();

      if (key) {
        if (parsed[key]) {
          parsed[key] += ', ' + val;
        } else {
          parsed[key] = val;
        }
      }
    });

    return parsed;
  }

  var FORM_URLENCODED = 'application/x-www-form-urlencoded';
  var FORM_DATA = 'multipart/form-data';
  var apply;

  var TryIt = function($scope) {
    this.getPathBuilder = function() {
      return $scope.pathBuilder;
    };

    this.method = $scope.method;
    this.httpMethod = $scope.method.method;
    this.headers = {};
    this.queryParameters = {};
    this.formParameters = {};
    this.supportsCustomBody = this.supportsFormUrlencoded = this.supportsFormData = false;

    for (var mediaType in $scope.method.body) {
      this.mediaType = this.mediaType || mediaType;
      this.supportsMediaType = true;

      if (mediaType === FORM_URLENCODED) {
        this.supportsFormUrlencoded = true;
      } else if (mediaType === FORM_DATA) {
        this.supportsFormData = true;
      } else {
        this.supportsCustomBody = true;
      }
    }

    $scope.apiClient = this;
    this.parsed = $scope.api;
    this.securitySchemes = $scope.method.securitySchemes();
    this.keychain = $scope.ramlConsole.keychain;

    apply = function() {
      $scope.$apply.apply($scope, arguments);
    };
  };

  TryIt.prototype.showBody = function() {
    return this.supportsCustomBody && !this.showUrlencodedForm() && !this.showMultipartForm();
  };

  TryIt.prototype.showUrlencodedForm = function() {
    if (this.mediaType) {
      return this.mediaType === FORM_URLENCODED;
    } else {
      return (!this.supportsCustomBody && this.supportsFormUrlencoded);
    }
  };

  TryIt.prototype.showMultipartForm = function() {
    if (this.mediaType) {
      return this.mediaType === FORM_DATA;
    } else  {
      return (!this.supportsCustomBody && !this.supportsFormUrlencoded && this.supportsFormData);
    }
  };

  TryIt.prototype.inProgress = function() {
    return (this.response && !this.response.status && !this.missingUriParameters);
  };

  TryIt.prototype.fillBody = function($event) {
    $event.preventDefault();
    this.body = this.method.body[this.mediaType].example;
  };

  TryIt.prototype.bodyHasExample = function() {
    return !!this.method.body[this.mediaType];
  };

  TryIt.prototype.execute = function() {
    this.missingUriParameters = false;
    this.disallowedAnonymousRequest = false;

    var response = this.response = {};

    function handleResponse(jqXhr) {
      response.body = jqXhr.responseText,
      response.status = jqXhr.status,
      response.headers = parseHeaders(jqXhr.getAllResponseHeaders());

      if (response.headers['content-type']) {
        response.contentType = response.headers['content-type'].split(';')[0];
      }
      apply();
    }

    try {
      var pathBuilder = this.getPathBuilder();
      var client = RAML.Client.create(this.parsed, function(client) {
        client.baseUriParameters(pathBuilder.baseUriContext);
      });
      var url = this.response.requestUrl = client.baseUri + pathBuilder(pathBuilder.segmentContexts);
      if (RAML.Settings.proxy) {
        url = RAML.Settings.proxy + url;
      }
      var request = RAML.Client.Request.create(url, this.httpMethod);

      if (!isEmpty(this.queryParameters)) {
        request.data(filterEmpty(this.queryParameters));
      }

      if (!isEmpty(this.formParameters)) {
        request.data(filterEmpty(this.formParameters));
      }

      if (!isEmpty(this.headers)) {
        request.headers(filterEmpty(this.headers));
      }

      if (this.mediaType) {
        request.header('Content-Type', this.mediaType);
      }

      if (this.showBody()) {
        request.data(this.body);
      }

      var authStrategy;

      try {
        if (this.keychain.selectedScheme === 'anonymous' && !this.method.allowsAnonymousAccess()) {
          this.disallowedAnonymousRequest = true;
        }

        var scheme = this.securitySchemes && this.securitySchemes[this.keychain.selectedScheme];
        var credentials = this.keychain[this.keychain.selectedScheme];
        authStrategy = RAML.Client.AuthStrategies.for(scheme, credentials);
      } catch (e) {
        // custom strategies aren't supported yet.
      }

      authStrategy.authenticate().then(function(token) {
        token.sign(request);
        $.ajax(request.toOptions()).then(
          function(data, textStatus, jqXhr) { handleResponse(jqXhr); },
          function(jqXhr) { handleResponse(jqXhr); }
        );
      });
    } catch (e) {
      this.response = undefined;
      this.missingUriParameters = true;
    }
  };

  RAML.Controllers.TryIt = TryIt;
})();

'use strict';

(function() {
  RAML.Directives = {};
})();

(function() {
  'use strict';

  RAML.Directives.apiResources = function() {

    return {
      restrict: 'E',
      templateUrl: 'views/api_resources.tmpl.html',
      replace: true
    };
  };
})();

'use strict';

(function() {
  RAML.Directives.basicAuth = function() {
    return {
      restrict: 'E',
      templateUrl: 'views/basic_auth.tmpl.html',
      replace: true,
      scope: {
        credentials: '='
      }
    };
  };
})();

(function() {
  'use strict';

  var formatters = {
    'application/json' : function(code) {
      return vkbeautify.json(code);
    },
    'text/xml' : function(code) {
      return vkbeautify.xml(code);
    },
    'default' : function(code) {
      return code;
    }
  };

  function sanitize(options) {
    var code = options.code || '',
        formatter = formatters[options.mode] || formatters.default;

    try {
      options.code = formatter(code);
    } catch(e) {}
  }

  var Controller = function($scope, $element) {
    sanitize($scope);

    this.editor = new CodeMirror($element[0], {
      mode: $scope.mode,
      readOnly: true,
      value: $scope.code,
      lineNumbers: true,
      indentUnit: 4
    });

    this.editor.setSize('100%', '100%');
  };

  Controller.prototype.refresh = function(options) {
    sanitize(options);
    this.editor.setOption('mode', options.mode);
    this.editor.setValue(options.code);

    this.editor.refresh();
  };

  var link = function(scope, element, attrs, editor) {
    scope.$watch('visible', function(visible) {
      if (visible) {
        editor.refresh(scope);
      }
    });
  };

  RAML.Directives.codeMirror = function() {
    return {
      link: link,
      restrict: 'A',
      replace: true,
      controller: Controller,
      scope: {
        code: '=codeMirror',
        visible: '=',
        mode: '@?'
      }
    };
  };

  RAML.Directives.codeMirror.Controller = Controller;
})();

(function() {
  'use strict';

  // NOTE: This directive relies on the collapsible content
  // and collapsible toggle to live in the same scope.

  var Controller = function() {};

  RAML.Directives.collapsible = function() {
    return {
      controller: Controller,
      restrict: 'EA',
      scope: true,
      link: {
        pre: function(scope, element, attrs) {
          if (attrs.hasOwnProperty('collapsed')) {
            scope.collapsed = true;
          }
        }
      }
    };
  };

  RAML.Directives.collapsibleToggle = function() {
    return {
      require: '^collapsible',
      restrict: 'EA',
      link: function(scope, element) {
        element.bind('click', function() {
          scope.$apply(function() {
            scope.collapsed = !scope.collapsed;
          });
        });
      }
    };
  };

  RAML.Directives.collapsibleContent = function() {
    return {
      require: '^collapsible',
      restrict: 'EA',
      link: function(scope, element) {
        scope.$watch('collapsed', function(collapsed) {
          element.css('display', collapsed ? 'none' : 'block');
          element.parent().removeClass('collapsed expanded');
          element.parent().addClass(collapsed ? 'collapsed' : 'expanded');
        });
      }
    };
  };

})();

(function() {
  'use strict';

  RAML.Directives.documentation = function() {
    return {
      controller: RAML.Controllers.Documentation,
      restrict: 'E',
      templateUrl: 'views/documentation.tmpl.html',
      replace: true
    };
  };
})();

(function() {
  'use strict';

  // enhancement to ng-model for input[type="file"]
  // code for this directive taken from:
  // https://github.com/marcenuc/angular.js/commit/2bfff4668c341ddcfec0120c9a5018b0c2463982
  RAML.Directives.input = function() {
    return {
      restrict: 'E',
      require: '?ngModel',
      link: function(scope, element, attr, ctrl) {
        if (ctrl && attr.type && attr.type.toLowerCase() === 'file') {
          element.bind('change', function() {
            scope.$apply(function() {
              var files = element[0].files;
              var viewValue = attr.multiple ? files : files[0];

              ctrl.$setViewValue(viewValue);
            });
          });
        }
      }
    };
  };
})();

(function() {
  'use strict';

  RAML.Directives.markdown = function($sanitize, $parse) {
    var converter = new Showdown.converter();

    var link = function(scope, element, attrs) {
      var markdown = $parse(attrs.markdown)(scope);

      var result = converter.makeHtml(markdown || '');

      element.html($sanitize(result));
    };

    return {
      restrict: 'A',
      link: link
    };
  };
})();

(function() {
  'use strict';

  var controller = function($scope) {
    $scope.methodView = this;
    this.method = $scope.method;
  };

  controller.prototype.toggleExpansion = function() {
    this.expanded = !this.expanded;
  };

  controller.prototype.cssClass = function() {
    if (this.expanded) {
      return 'expanded ' + this.method.method;
    } else {
      return 'collapsed ' + this.method.method;
    }
  };

  RAML.Directives.method = function() {
    return {
      controller: controller,
      require: ['^resource', 'method'],
      restrict: 'E',
      templateUrl: 'views/method.tmpl.html',
      replace: true,
      link: function(scope, element, attrs, controllers) {
        var resourceView = controllers[0],
            methodView   = controllers[1];

        if (resourceView.expandInitially(scope.method)) {
          methodView.toggleExpansion();
        }
      }
    };
  };
})();

'use strict';

(function() {
  RAML.Directives.namedParameters = function() {
    return {
      restrict: 'E',
      link: function() {},
      templateUrl: 'views/named_parameters.tmpl.html',
      replace: true,
      scope: {
        heading: '@',
        parameters: '=',
        requestData: '='
      }
    };
  };
})();

(function() {
  'use strict';

  RAML.Directives.namedParametersDocumentation = function() {
    return {
      restrict: 'E',
      controller: RAML.Controllers.NamedParametersDocumentation,
      templateUrl: 'views/named_parameters_documentation.tmpl.html',
      replace: true,
      scope: {
        heading: '@',
        parameters: '='
      }
    };
  };
})();

'use strict';

(function() {
  RAML.Directives.oauth2 = function() {
    return {
      restrict: 'E',
      templateUrl: 'views/oauth2.tmpl.html',
      replace: true,
      scope: {
        credentials: '='
      }
    };
  };
})();

'use strict';

(function() {
  RAML.Directives.parameterFields = function() {
    return {
      restrict: 'E',
      templateUrl: 'views/parameter_fields.tmpl.html',
      // replace: true,
      scope: {
        parameters: '=',
        requestData: '='
      }
    };
  };
})();

'use strict';

(function() {
  RAML.Directives.parameters = function() {
    return {
      restrict: 'E',
      templateUrl: 'views/parameters.tmpl.html',
      controller: RAML.Controllers.Parameters
    };
  };
})();

(function() {
  'use strict';

  var Controller = function($scope) {
    $scope.pathBuilder = new RAML.Client.PathBuilder.create($scope.resource.pathSegments);
    $scope.pathBuilder.baseUriContext = {};
    $scope.pathBuilder.segmentContexts = $scope.resource.pathSegments.map(function() {
      return {};
    });
  };

  RAML.Directives.pathBuilder = function() {
    return {
      restrict: 'E',
      controller: Controller,
      templateUrl: 'views/path_builder.tmpl.html',
      replace: true
    };
  };
})();

(function() {
  'use strict';

  RAML.Directives.ramlConsole = function(ramlParserWrapper) {

    var link = function ($scope, $el, $attrs, controller) {
      ramlParserWrapper.onParseSuccess(function(raml) {
        $scope.api = controller.api = RAML.Inspector.create(raml);
      });

      ramlParserWrapper.onParseError(function(error) {
        $scope.parseError = error;
      });
    };

    return {
      restrict: 'E',
      templateUrl: 'views/raml-console.tmpl.html',
      controller: RAML.Controllers.RAMLConsole,
      scope: {
        src: '@'
      },
      link: link
    };
  };
})();

(function() {
  'use strict';

  RAML.Directives.ramlConsoleInitializer = function(ramlParserWrapper) {
    var controller = function($scope) {
      $scope.consoleLoader = this;
    };

    controller.prototype.load = function() {
      ramlParserWrapper.load(this.location);
      this.finished = true;
    };

    controller.prototype.parse = function() {
      ramlParserWrapper.parse(this.raml);
      this.finished = true;
    };

    var link = function($scope, $element, $attrs, controller) {
      if (document.location.search.indexOf('?raml=') !== -1) {
        controller.location = document.location.search.replace('?raml=', '');
        controller.load();
      }
    };

    return { restrict: 'E', controller: controller, link: link };
  };
})();

'use strict';

(function() {
  RAML.Directives.requests = function() {
    return {
      restrict: 'E',
      templateUrl: 'views/requests.tmpl.html'
    };
  };
})();

(function() {
  'use strict';

  var controller = function($scope) {
    $scope.resourceView = this;
    this.resource = $scope.resource;
  };

  controller.prototype.expandInitially = function(method) {
    if (method.method === this.methodToExpand) {
      delete this.methodToExpand;
      return true;
    }
    return false;
  };

  controller.prototype.expandMethod = function(method) {
    this.methodToExpand = method.method;
  };

  controller.prototype.toggleExpansion = function() {
    this.expanded = !this.expanded;
  };

  controller.prototype.type = function() {
    return this.resource.resourceType;
  };

  controller.prototype.traits = function() {
    return this.resource.traits || [];
  };

  RAML.Directives.resource = function() {
    return {
      restrict: 'E',
      templateUrl: 'views/resource.tmpl.html',
      replace: true,
      controller: controller
    };
  };
})();

'use strict';

(function() {
  RAML.Directives.responses = function() {
    return {
      restrict: 'E',
      templateUrl: 'views/responses.tmpl.html'
    };
  };
})();

(function() {
  'use strict';

  RAML.Directives.rootDocumentation = function() {
    return {
      restrict: 'E',
      templateUrl: 'views/root_documentation.tmpl.html',
      replace: true
    };
  };
})();

'use strict';

(function() {
  RAML.Directives.securitySchemes = function() {

    var controller = function($scope) {
      $scope.securitySchemes = this;
    };

    controller.prototype.supports = function(scheme) {
      return (scheme.type === 'OAuth 2.0' || scheme.type === 'Basic Authentication');
    };

    return {
      restrict: 'E',
      templateUrl: 'views/security_schemes.tmpl.html',
      replace: true,
      controller: controller,
      scope: {
        schemes: '=',
        keychain: '='
      }
    };
  };
})();

(function() {
  'use strict';

  ////////////
  // tabset
  ////////////

  RAML.Directives.tabset = function() {
    return {
      restrict: 'E',
      replace: true,
      transclude: true,
      controller: RAML.Controllers.tabset,
      templateUrl: 'views/tabset.tmpl.html'
    };
  };

  ////////////////
  // tabs
  ///////////////

  var link = function($scope, $element, $attrs, tabsetCtrl) {
    tabsetCtrl.addTab($scope);
  };

  RAML.Directives.tab = function() {
    return {
      restrict: 'E',
      require: '^tabset',
      replace: true,
      transclude: true,
      link: link,
      templateUrl: 'views/tab.tmpl.html',
      scope: {
        heading: '@',
        active: '=?',
        disabled: '=?'
      }
    };
  };
})();

(function() {
  'use strict';

  RAML.Directives.tryIt = function() {
    return {
      restrict: 'E',
      templateUrl: 'views/try_it.tmpl.html',
      replace: true,
      controller: RAML.Controllers.TryIt
    };
  };
})();

(function() {
  'use strict';

  var Controller = function($scope, $attrs, $parse) {
    var constraints = $parse($attrs.constraints)($scope);
    this.validator = RAML.Client.Validator.from(constraints);
  };

  Controller.prototype.validate = function(value) {
    return this.validator.validate(value);
  };

  var link = function($scope, $el, $attrs, controllers) {
    var modelController    = controllers[0],
        validateController = controllers[1],
        errorClass = $attrs.invalidClass || 'warning';

    function validateField() {
      var errors = validateController.validate(modelController.$modelValue);

      if (errors) {
        $el.addClass(errorClass);
      } else {
        $el.removeClass(errorClass);
      }
    }

    $el.bind('blur', function() {
      $scope.$apply(validateField);
    });

    $el.bind('focus', function() {
      $scope.$apply(function() {
        $el.removeClass(errorClass);
      });
    });

    angular.element($el[0].form).bind('submit', function() {
      $scope.$apply(validateField);
    });
  };

  RAML.Directives.validatedInput = function() {
    return {
      restrict: 'A',
      require: ['ngModel', 'validatedInput'],
      controller: Controller,
      link: link
    };
  };
})();

RAML.Filters = {};

(function() {
  'use strict';

  RAML.Filters.nameFromParameterizable = function() {
    return function(input) {
      if (typeof input === 'object' && input !== null) {
        return Object.keys(input)[0];
      } else if (input) {
        return input;
      } else {
        return undefined;
      }
    };
  };
})();

(function() {
  'use strict';

  RAML.Filters.yesNo = function() {
    return function(input) {
      return input ? 'Yes' : 'No';
    };
  };
})();

(function() {
  'use strict';

  RAML.Services = {};
})();

(function() {
  'use strict';

  RAML.Services.RAMLParserWrapper = function($rootScope, ramlParser, $q) {
    var ramlProcessor, errorProcessor, whenParsed, PARSE_SUCCESS = 'event:raml-parsed';

    var load = function(file) {
      setPromise(ramlParser.loadFile(file));
    };

    var parse = function(raml) {
      setPromise(ramlParser.load(raml));
    };

    var onParseSuccess = function(cb) {
      ramlProcessor = function() {
        cb.apply(this, arguments);
        if (!$rootScope.$$phase) {
          // handle aggressive digesters!
          $rootScope.$digest();
        }
      };

      if (whenParsed) {
        whenParsed.then(ramlProcessor);
      }
    };

    var onParseError = function(cb) {
      errorProcessor = function() {
        cb.apply(this, arguments);
        if (!$rootScope.$$phase) {
          // handle aggressive digesters!
          $rootScope.$digest();
        }
      };

      if (whenParsed) {
        whenParsed.then(undefined, errorProcessor);
      }

    };

    var setPromise = function(promise) {
      whenParsed = promise;

      if (ramlProcessor || errorProcessor) {
        whenParsed.then(ramlProcessor, errorProcessor);
      }
    };

    $rootScope.$on(PARSE_SUCCESS, function(e, raml) {
      setPromise($q.when(raml));
    });

    return {
      load: load,
      parse: parse,
      onParseSuccess: onParseSuccess,
      onParseError: onParseError
    };
  };
})();

'use strict';

(function() {
  RAML.Settings = RAML.Settings || {};

  var location = window.location;

  var uri = location.protocol + '//' + location.host + location.pathname + 'authentication/oauth2.html';
  RAML.Settings.oauth2RedirectUri = RAML.Settings.oauth2RedirectUri || uri;
  // RAML.Settings.proxy = RAML.Settings.proxy || '/proxy/';
})();

'use strict';

(function() {
  var module = angular.module('raml', []);

  module.factory('ramlParser', function () {
    return RAML.Parser;
  });

})();

'use strict';

(function() {
  var module = angular.module('ramlConsoleApp', ['raml', 'ngSanitize']);

  module.directive('apiResources', RAML.Directives.apiResources);
  module.directive('basicAuth', RAML.Directives.basicAuth);
  module.directive('codeMirror', RAML.Directives.codeMirror);
  module.directive('collapsible', RAML.Directives.collapsible);
  module.directive('collapsibleContent', RAML.Directives.collapsibleContent);
  module.directive('collapsibleToggle', RAML.Directives.collapsibleToggle);
  module.directive('documentation', RAML.Directives.documentation);
  module.directive('input', RAML.Directives.input);
  module.directive('markdown', RAML.Directives.markdown);
  module.directive('method', RAML.Directives.method);
  module.directive('namedParameters', RAML.Directives.namedParameters);
  module.directive('namedParametersDocumentation', RAML.Directives.namedParametersDocumentation);
  module.directive('oauth2', RAML.Directives.oauth2);
  module.directive('parameterFields', RAML.Directives.parameterFields);
  module.directive('parameters', RAML.Directives.parameters);
  module.directive('pathBuilder', RAML.Directives.pathBuilder);
  module.directive('ramlConsole', RAML.Directives.ramlConsole);
  module.directive('ramlConsoleInitializer', RAML.Directives.ramlConsoleInitializer);
  module.directive('requests', RAML.Directives.requests);
  module.directive('resource', RAML.Directives.resource);
  module.directive('responses', RAML.Directives.responses);
  module.directive('rootDocumentation', RAML.Directives.rootDocumentation);
  module.directive('securitySchemes', RAML.Directives.securitySchemes);
  module.directive('tab', RAML.Directives.tab);
  module.directive('tabset', RAML.Directives.tabset);
  module.directive('tryIt', RAML.Directives.tryIt);
  module.directive('validatedInput', RAML.Directives.validatedInput);

  module.controller('TryItController', RAML.Controllers.tryIt);

  module.service('ramlParserWrapper', RAML.Services.RAMLParserWrapper);

  module.filter('nameFromParameterizable', RAML.Filters.nameFromParameterizable);
  module.filter('yesNo', RAML.Filters.yesNo);
})();

angular.module('ramlConsoleApp').run(['$templateCache', function($templateCache) {

  $templateCache.put('views/api_resources.tmpl.html',
    "<div id=\"raml-console-api-reference\" role=\"resources\">\n" +
    "  <div collapsible role=\"resource-group\" class=\"resource-group\" ng-repeat=\"resourceGroup in api.resourceGroups\">\n" +
    "    <h1 collapsible-toggle class='path'>\n" +
    "      {{resourceGroup[0].pathSegments[0].toString()}}\n" +
    "      <i ng-class=\"{'icon-caret-right': collapsed, 'icon-caret-down': !collapsed}\"></i>\n" +
    "    </h1>\n" +
    "\n" +
    "    <div collapsible-content>\n" +
    "      <resource ng-repeat=\"resource in resourceGroup\"></resource>\n" +
    "    </div>\n" +
    "  </div>\n" +
    "</div>\n"
  );


  $templateCache.put('views/basic_auth.tmpl.html',
    "<fieldset class=\"labelled-inline\" role=\"basic\">\n" +
    "  <div class=\"control-group\">\n" +
    "    <label for=\"username\">Username:</label>\n" +
    "    <input type=\"text\" name=\"username\" ng-model='credentials.username'/>\n" +
    "  </div>\n" +
    "\n" +
    "  <div class=\"control-group\">\n" +
    "    <label for=\"password\">Password:</label>\n" +
    "    <input type=\"password\" name=\"password\" ng-model='credentials.password'/>\n" +
    "  </div>\n" +
    "</fieldset>\n"
  );


  $templateCache.put('views/documentation.tmpl.html',
    "<section class='documentation' role='documentation'>\n" +
    "  <ul role=\"traits\" class=\"modifiers\">\n" +
    "    <li class=\"trait\" ng-repeat=\"trait in documentation.traits()\">\n" +
    "      {{trait|nameFromParameterizable}}\n" +
    "    </li>\n" +
    "  </ul>\n" +
    "\n" +
    "  <div role=\"full-description\" class=\"description\"\n" +
    "       ng-if=\"method.description\"\n" +
    "       markdown=\"method.description\">\n" +
    "  </div>\n" +
    "\n" +
    "  <tabset>\n" +
    "    <tab role='documentation-requests' heading=\"Request\" active='documentation.requestsActive' disabled=\"!documentation.hasRequestDocumentation\">\n" +
    "      <parameters></parameters>\n" +
    "      <requests></requests>\n" +
    "    </tab>\n" +
    "    <tab role='documentation-responses' class=\"responses\" heading=\"Responses\" active='documentation.responsesActive' disabled='!documentation.hasResponseDocumentation'>\n" +
    "      <responses></responses>\n" +
    "    </tab>\n" +
    "    <tab role=\"try-it\" heading=\"Try It\" active=\"documentation.tryItActive\" disabled=\"!documentation.hasTryIt\">\n" +
    "      <try-it></try-it>\n" +
    "    </tab>\n" +
    "  </tabset>\n" +
    "</section>\n"
  );


  $templateCache.put('views/method.tmpl.html',
    "<div class='method' role=\"method\" ng-class=\"methodView.cssClass()\">\n" +
    "  <div class='accordion-toggle method-summary' role=\"methodSummary\" ng-class='method.method' ng-click='methodView.toggleExpansion()'>\n" +
    "    <span role=\"verb\" class='method-name' ng-class='method.method'>{{method.method}}</span>\n" +
    "    <div class='filler' ng-show='methodView.expanded' ng-class='method.method'></div>\n" +
    "\n" +
    "    <div class='description' role=\"description\" ng-if=\"!methodView.expanded\">\n" +
    "       {{method.description}}\n" +
    "       <i class='icon-caret-right'></i>\n" +
    "    </div>\n" +
    "\n" +
    "  </div>\n" +
    "\n" +
    "  <div ng-show='methodView.expanded'>\n" +
    "    <documentation></documentation>\n" +
    "  </div>\n" +
    "</div>\n"
  );


  $templateCache.put('views/named_parameters.tmpl.html',
    "<fieldset class='labelled-inline bordered' ng-show=\"parameters\">\n" +
    "  <legend>{{heading}}</legend>\n" +
    "  <parameter-fields parameters=\"parameters\" request-data=\"requestData\"></parameter-fields>\n" +
    "</fieldset>\n"
  );


  $templateCache.put('views/named_parameters_documentation.tmpl.html',
    "<section class='named-parameters' ng-show='parameters'>\n" +
    "  <h2>{{heading}}</h2>\n" +
    "  <section role='parameter' class='parameter' ng-repeat='param in parameters'>\n" +
    "    <h4 class='strip-whitespace'>\n" +
    "      <span role=\"display-name\">{{param.displayName}}</span>\n" +
    "      <span class=\"constraints\">{{namedParametersDocumentation.constraints(param)}}</span>\n" +
    "    </h4>\n" +
    "\n" +
    "    <div class=\"info\">\n" +
    "      <div ng-if=\"param.example\"><span class=\"label\">Example:</span> <code class=\"well\" role=\"example\">{{param.example}}</code></div>\n" +
    "      <div role=\"description\" markdown=\"param.description\"></div>\n" +
    "    </div>\n" +
    "  </section>\n" +
    "</section>\n"
  );


  $templateCache.put('views/oauth2.tmpl.html',
    "<fieldset class=\"labelled-inline\" role=\"oauth2\">\n" +
    "  <div class=\"control-group\">\n" +
    "    <label for=\"clientId\">Client ID:</label>\n" +
    "    <input type=\"text\" name=\"clientId\" ng-model='credentials.clientId'/>\n" +
    "  </div>\n" +
    "\n" +
    "  <div class=\"control-group\">\n" +
    "    <label for=\"clientSecret\">Client Secret:</label>\n" +
    "    <input type=\"password\" name=\"clientSecret\" ng-model='credentials.clientSecret'/>\n" +
    "  </div>\n" +
    "</fieldset>\n"
  );


  $templateCache.put('views/parameter_fields.tmpl.html',
    "<fieldset>\n" +
    "  <div class=\"control-group\" ng-repeat=\"(parameterName, parameter) in parameters track by parameterName\">\n" +
    "    <label for=\"{{parameterName}}\">{{parameter.displayName}}:</label>\n" +
    "    <ng-switch on='parameter.type'>\n" +
    "      <input ng-switch-when='file' name=\"{{parameterName}}\" type='file' ng-model='requestData[parameterName]'/>\n" +
    "      <input ng-switch-default validated-input name=\"{{parameterName}}\" type='text' ng-model='requestData[parameterName]' placeholder='{{parameter.example}}' ng-trim=\"false\" constraints='parameter'/>\n" +
    "    </ng-switch>\n" +
    "  </div>\n" +
    "</fieldset>\n"
  );


  $templateCache.put('views/parameters.tmpl.html',
    "<named-parameters-documentation ng-repeat='parameterGroup in parameterGroups' heading='{{parameterGroup[0]}}' role='parameter-group' parameters='parameterGroup[1]'></named-parameters-documentation>\n"
  );


  $templateCache.put('views/path_builder.tmpl.html',
    "<span role=\"path\" class=\"path\">\n" +
    "  <span clsas=\"segment\">\n" +
    "    <span ng-repeat='token in api.baseUri.tokens track by $index'>\n" +
    "      <input type='text' validated-input ng-if='api.baseUri.parameters[token]'\n" +
    "                             name=\"{{token}}\"\n" +
    "                             ng-model=\"pathBuilder.baseUriContext[token]\"\n" +
    "                             placeholder=\"{{token}}\"\n" +
    "                             constraints=\"api.baseUri.parameters[token]\"\n" +
    "                             invalid-class=\"error\"/>\n" +
    "      <span class=\"segment\" ng-if=\"!api.baseUri.parameters[token]\">{{token}}</span>\n" +
    "    </span>\n" +
    "  <span role='segment' ng-repeat='segment in resource.pathSegments' ng-init=\"$segmentIndex = $index\">\n" +
    "    <span ng-repeat='token in segment.tokens track by $index'>\n" +
    "      <input type='text' validated-input ng-if='segment.parameters[token]'\n" +
    "                             name=\"{{token}}\"\n" +
    "                             ng-model=\"pathBuilder.segmentContexts[$segmentIndex][token]\"\n" +
    "                             placeholder=\"{{token}}\"\n" +
    "                             constraints=\"segment.parameters[token]\"\n" +
    "                             invalid-class=\"error\"/>\n" +
    "      <span class=\"segment\" ng-if=\"!segment.parameters[token]\">{{token}}</span>\n" +
    "    </span>\n" +
    "  </span>\n" +
    "</span>\n"
  );


  $templateCache.put('views/raml-console.tmpl.html',
    "<article role=\"api-console\" id=\"raml-console\">\n" +
    "  <div role=\"error\" ng-if=\"parseError\">\n" +
    "    {{parseError}}\n" +
    "  </div>\n" +
    "\n" +
    "  <header id=\"raml-console-api-title\">{{api.title}}</header>\n" +
    "\n" +
    "  <nav id=\"raml-console-main-nav\" ng-if='ramlConsole.showRootDocumentation()' ng-switch='ramlConsole.view'>\n" +
    "    <a class=\"btn\" ng-switch-when='rootDocumentation' role=\"view-api-reference\" ng-click='ramlConsole.gotoView(\"apiReference\")'>&larr; API Reference</a>\n" +
    "    <a class=\"btn\" ng-switch-default role=\"view-root-documentation\" ng-click='ramlConsole.gotoView(\"rootDocumentation\")'>Documentation &rarr;</a>\n" +
    "  </nav>\n" +
    "\n" +
    "  <div id=\"raml-console-content\" ng-switch='ramlConsole.view'>\n" +
    "    <div ng-switch-when='rootDocumentation'>\n" +
    "      <root-documentation></root-documentation>\n" +
    "    </div>\n" +
    "    <div ng-switch-default>\n" +
    "      <api-resources></api-resources>\n" +
    "    </div>\n" +
    "  </div>\n" +
    "</article>\n"
  );


  $templateCache.put('views/requests.tmpl.html',
    "<h2 ng-if=\"method.body\">Body</h2>\n" +
    "<section ng-repeat=\"(mediaType, definition) in method.body track by mediaType\">\n" +
    "  <h4>{{mediaType}}</h4>\n" +
    "  <section ng-if=\"definition.schema\">\n" +
    "    <h5>Schema</h5>\n" +
    "    <div class=\"code\" code-mirror=\"definition.schema\" mode=\"{{mediaType}}\" visible=\"methodView.expanded && documentation.requestsActive\"></div>\n" +
    "  </section>\n" +
    "  <section ng-if=\"definition.example\">\n" +
    "    <h5>Example</h5>\n" +
    "    <div class=\"code\" code-mirror=\"definition.example\" mode=\"{{mediaType}}\" visible=\"methodView.expanded && documentation.requestsActive\"></div>\n" +
    "  </section>\n" +
    "</section>\n"
  );


  $templateCache.put('views/resource.tmpl.html',
    "<div ng-class=\"{expanded: resourceView.expanded, collapsed: !resourceView.expanded}\"\n" +
    "     class='resource' role=\"resource\">\n" +
    "\n" +
    "  <div class='summary accordion-toggle' role='resource-summary' ng-click='resourceView.toggleExpansion()'>\n" +
    "    <ul class=\"modifiers\">\n" +
    "      <li class=\"resource-type\" role=\"resource-type\" ng-if='resourceView.type()'>\n" +
    "        {{resourceView.type()|nameFromParameterizable}}\n" +
    "      </li>\n" +
    "      <li class=\"trait\" role=\"trait\" ng-repeat=\"trait in resourceView.traits()\">\n" +
    "        {{trait|nameFromParameterizable}}\n" +
    "      </li>\n" +
    "    </ul>\n" +
    "\n" +
    "    <h3 class=\"path\">\n" +
    "      <span role='segment' ng-repeat='segment in resource.pathSegments'>{{segment.toString()}} </span>\n" +
    "    </h3>\n" +
    "    <ul class='methods' role=\"methods\" ng-hide=\"resourceView.expanded\">\n" +
    "      <li class='method-name' ng-class='method.method'\n" +
    "          ng-click='resourceView.expandMethod(method)' ng-repeat=\"method in resource.methods\">{{method.method}}</li>\n" +
    "    </ul>\n" +
    "  </div>\n" +
    "\n" +
    "  <div ng-if='resourceView.expanded'>\n" +
    "    <div>\n" +
    "      <div role='description'\n" +
    "           class='description'\n" +
    "           ng-if='resource.description'\n" +
    "           markdown='resource.description'>\n" +
    "      </div>\n" +
    "      <div class='accordion' role=\"methods\">\n" +
    "        <method ng-repeat=\"method in resource.methods\"></method>\n" +
    "      </div>\n" +
    "    </div>\n" +
    "  </div>\n" +
    "</div>\n"
  );


  $templateCache.put('views/responses.tmpl.html',
    "<section collapsible collapsed ng-repeat='(responseCode, response) in method.responses'>\n" +
    "  <h2 role=\"response-code\" collapsible-toggle>\n" +
    "    <a href=''>\n" +
    "      <i ng-class=\"{'icon-caret-right': collapsed, 'icon-caret-down': !collapsed}\"></i>\n" +
    "      {{responseCode}}\n" +
    "    </a>\n" +
    "  </h2>\n" +
    "  <div collapsible-content>\n" +
    "    <section role='response'>\n" +
    "      <div markdown='response.description'></div>\n" +
    "      <named-parameters-documentation heading='Headers' role='parameter-group' parameters='response.headers'></named-parameters-documentation>\n" +
    "      <h3 ng-show=\"response.body\">Body</h3>\n" +
    "      <section ng-repeat=\"(mediaType, definition) in response.body track by mediaType\">\n" +
    "        <h4>{{mediaType}}</h4>\n" +
    "        <section ng-if=\"definition.schema\">\n" +
    "          <h5>Schema</h5>\n" +
    "          <div class=\"code\" mode='{{mediaType}}' code-mirror=\"definition.schema\" visible=\"methodView.expanded && !collapsed\"></div>\n" +
    "        </section>\n" +
    "        <section ng-if=\"definition.example\">\n" +
    "          <h5>Example</h5>\n" +
    "          <div class=\"code\" mode='{{mediaType}}' code-mirror=\"definition.example\" visible=\"methodView.expanded && !collapsed\"></div>\n" +
    "        </section>\n" +
    "      </section>\n" +
    "    </section>\n" +
    "  </div>\n" +
    "</section>\n"
  );


  $templateCache.put('views/root_documentation.tmpl.html',
    "<div role=\"root-documentation\">\n" +
    "  <section collapsible collapsed ng-repeat=\"document in api.documentation\">\n" +
    "    <h2 collapsible-toggle>{{document.title}}</h2>\n" +
    "    <div collapsible-content class=\"content\">\n" +
    "      <div markdown='document.content'></div>\n" +
    "    </div>\n" +
    "  </section>\n" +
    "</div>\n"
  );


  $templateCache.put('views/security_schemes.tmpl.html',
    "<div class=\"authentication\">\n" +
    "  <fieldset class=\"labelled-radio-group bordered\">\n" +
    "    <legend>Authentication</legend>\n" +
    "    <label for=\"scheme\">Type:</label>\n" +
    "\n" +
    "    <div class=\"radio-group\">\n" +
    "      <label class=\"radio\">\n" +
    "        <input type=\"radio\" name=\"scheme\" value=\"anonymous\" ng-model=\"keychain.selectedScheme\"> Anonymous </input>\n" +
    "      </label>\n" +
    "      <span ng-repeat=\"(name, scheme) in schemes\">\n" +
    "        <label class=\"radio\"  ng-if=\"securitySchemes.supports(scheme)\">\n" +
    "          <input type=\"radio\" name=\"scheme\" value=\"{{name}}\" ng-model=\"keychain.selectedScheme\"> {{ name }} </input>\n" +
    "        </label>\n" +
    "      </span>\n" +
    "    </div>\n" +
    "  </fieldset>\n" +
    "\n" +
    "  <div ng-repeat=\"(name, scheme) in schemes\">\n" +
    "    <div ng-show=\"keychain.selectedScheme == name\">\n" +
    "      <div ng-switch=\"scheme.type\">\n" +
    "        <basic-auth ng-switch-when=\"Basic Authentication\" credentials='keychain[name]'></basic-auth>\n" +
    "        <oauth2 ng-switch-when=\"OAuth 2.0\" credentials='keychain[name]'></oauth2>\n" +
    "      </div>\n" +
    "    </div>\n" +
    "  </div>\n" +
    "</div>\n"
  );


  $templateCache.put('views/tab.tmpl.html',
    "<div class=\"tab-pane\" ng-class=\"{active: active, disabled: disabled}\" ng-show=\"active\" ng-transclude>\n" +
    "\n" +
    "</div>\n"
  );


  $templateCache.put('views/tabset.tmpl.html',
    "<div class=\"tabbable\">\n" +
    "  <ul class=\"nav nav-tabs\">\n" +
    "    <li ng-repeat=\"tab in tabs\" ng-class=\"{active: tab.active, disabled: tab.disabled}\">\n" +
    "      <a ng-click=\"tabset.select(tab)\">{{tab.heading}}</a>\n" +
    "    </li>\n" +
    "  </ul>\n" +
    "\n" +
    "  <div class=\"tab-content\" ng-transclude></div>\n" +
    "</div>\n"
  );


  $templateCache.put('views/try_it.tmpl.html',
    "<section class=\"try-it\">\n" +
    "\n" +
    "  <form>\n" +
    "    <path-builder></path-builder>\n" +
    "\n" +
    "    <security-schemes ng-if=\"apiClient.securitySchemes\" schemes=\"apiClient.securitySchemes\" keychain=\"ramlConsole.keychain\"></security-schemes>\n" +
    "    <named-parameters heading=\"Headers\" parameters=\"method.headers\" request-data=\"apiClient.headers\"></named-parameters>\n" +
    "    <named-parameters heading=\"Query Parameters\" parameters=\"method.queryParameters\" request-data=\"apiClient.queryParameters\"></named-parameters>\n" +
    "\n" +
    "    <div class=\"request-body\" ng-show=\"method.body\">\n" +
    "      <fieldset class=\"bordered\">\n" +
    "        <legend>Body</legend>\n" +
    "\n" +
    "        <fieldset class=\"labelled-radio-group media-types\" ng-show=\"apiClient.supportsMediaType\">\n" +
    "          <label>Content Type</label>\n" +
    "          <div class=\"radio-group\">\n" +
    "            <label class=\"radio\" ng-repeat=\"(mediaType, _) in method.body track by mediaType\">\n" +
    "              <input type=\"radio\" name=\"media-type\" value=\"{{mediaType}}\" ng-model=\"apiClient.mediaType\">\n" +
    "              {{mediaType}}\n" +
    "            </label>\n" +
    "          </div>\n" +
    "        </fieldset>\n" +
    "\n" +
    "        <div ng-if=\"apiClient.showBody()\">\n" +
    "          <textarea name=\"body\" ng-model='apiClient.body' ng-model=\"apiClient.body\"></textarea>\n" +
    "          <a href=\"#\" class=\"body-prefill\" ng-show=\"apiClient.bodyHasExample()\" ng-click=apiClient.fillBody($event)>Prefill with example</a>\n" +
    "        </div>\n" +
    "        <div class=\"labelled-inline\">\n" +
    "          <parameter-fields parameters='method.body[\"application/x-www-form-urlencoded\"].formParameters' request-data=\"apiClient.formParameters\" ng-if=\"apiClient.showUrlencodedForm()\"></parameter-fields>\n" +
    "          <parameter-fields parameters='method.body[\"multipart/form-data\"].formParameters' request-data=\"apiClient.formParameters\" ng-if=\"apiClient.showMultipartForm()\"></parameter-fields>\n" +
    "        </div>\n" +
    "      </fieldset>\n" +
    "    </div>\n" +
    "\n" +
    "    <div class=\"form-actions\">\n" +
    "      <i ng-show='apiClient.inProgress()' class=\"icon-spinner icon-spin icon-large\"></i>\n" +
    "\n" +
    "      <div role=\"error\" class=\"error\" ng-show=\"apiClient.missingUriParameters\">\n" +
    "        Required URI Parameters must be entered\n" +
    "      </div>\n" +
    "      <div role=\"warning\" class=\"warning\" ng-show=\"apiClient.disallowedAnonymousRequest\">\n" +
    "        Successful responses require authentication\n" +
    "      </div>\n" +
    "      <button role=\"try-it\" ng-class=\"'btn-' + method.method\" ng-click=\"apiClient.execute()\">\n" +
    "        {{method.method}}\n" +
    "      </button>\n" +
    "    </div>\n" +
    "  </form>\n" +
    "\n" +
    "  <div class=\"response\" ng-if=\"apiClient.response\">\n" +
    "    <h4>Response</h4>\n" +
    "    <div class=\"request-url\">\n" +
    "      <h5>Request URL</h5>\n" +
    "      <code class=\"response-value\">{{apiClient.response.requestUrl}}</code>\n" +
    "    </div>\n" +
    "\n" +
    "    <div class=\"status\">\n" +
    "      <h5>Status</h5>\n" +
    "      <code class=\"response-value\">{{apiClient.response.status}}</code>\n" +
    "    </div>\n" +
    "    <div class=\"headers\">\n" +
    "      <h5>Headers</h5>\n" +
    "      <ul class=\"response-value\">\n" +
    "        <li ng-repeat=\"(header, value) in apiClient.response.headers\">\n" +
    "          <code>\n" +
    "            <span class=\"header-key\">{{header}}:</span>\n" +
    "            <span class=\"header-value\">{{value}}</span>\n" +
    "          </code>\n" +
    "        </li>\n" +
    "      </ul>\n" +
    "    </div>\n" +
    "    <div class=\"body\">\n" +
    "      <h5>Body</h5>\n" +
    "      <div class=\"response-value\">\n" +
    "        <div class=\"code\" mode='{{apiClient.response.contentType}}' code-mirror=\"apiClient.response.body\" visible=\"apiClient.response.body\"></div>\n" +
    "      </div>\n" +
    "    </div>\n" +
    "  </div>\n" +
    "</section>\n"
  );

}]);
