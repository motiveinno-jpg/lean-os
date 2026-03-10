(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,67034,(e,t,r)=>{var n={675:function(e,t){"use strict";t.byteLength=function(e){var t=l(e),r=t[0],n=t[1];return(r+n)*3/4-n},t.toByteArray=function(e){var t,r,o=l(e),s=o[0],a=o[1],c=new i((s+a)*3/4-a),f=0,u=a>0?s-4:s;for(r=0;r<u;r+=4)t=n[e.charCodeAt(r)]<<18|n[e.charCodeAt(r+1)]<<12|n[e.charCodeAt(r+2)]<<6|n[e.charCodeAt(r+3)],c[f++]=t>>16&255,c[f++]=t>>8&255,c[f++]=255&t;return 2===a&&(t=n[e.charCodeAt(r)]<<2|n[e.charCodeAt(r+1)]>>4,c[f++]=255&t),1===a&&(t=n[e.charCodeAt(r)]<<10|n[e.charCodeAt(r+1)]<<4|n[e.charCodeAt(r+2)]>>2,c[f++]=t>>8&255,c[f++]=255&t),c},t.fromByteArray=function(e){for(var t,n=e.length,i=n%3,o=[],s=0,a=n-i;s<a;s+=16383)o.push(function(e,t,n){for(var i,o=[],s=t;s<n;s+=3)i=(e[s]<<16&0xff0000)+(e[s+1]<<8&65280)+(255&e[s+2]),o.push(r[i>>18&63]+r[i>>12&63]+r[i>>6&63]+r[63&i]);return o.join("")}(e,s,s+16383>a?a:s+16383));return 1===i?o.push(r[(t=e[n-1])>>2]+r[t<<4&63]+"=="):2===i&&o.push(r[(t=(e[n-2]<<8)+e[n-1])>>10]+r[t>>4&63]+r[t<<2&63]+"="),o.join("")};for(var r=[],n=[],i="u">typeof Uint8Array?Uint8Array:Array,o="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",s=0,a=o.length;s<a;++s)r[s]=o[s],n[o.charCodeAt(s)]=s;function l(e){var t=e.length;if(t%4>0)throw Error("Invalid string. Length must be a multiple of 4");var r=e.indexOf("=");-1===r&&(r=t);var n=r===t?0:4-r%4;return[r,n]}n[45]=62,n[95]=63},72:function(e,t,r){"use strict";var n=r(675),i=r(783),o="function"==typeof Symbol&&"function"==typeof Symbol.for?Symbol.for("nodejs.util.inspect.custom"):null;function s(e){if(e>0x7fffffff)throw RangeError('The value "'+e+'" is invalid for option "size"');var t=new Uint8Array(e);return Object.setPrototypeOf(t,a.prototype),t}function a(e,t,r){if("number"==typeof e){if("string"==typeof t)throw TypeError('The "string" argument must be of type string. Received type number');return f(e)}return l(e,t,r)}function l(e,t,r){if("string"==typeof e){var n=e,i=t;if(("string"!=typeof i||""===i)&&(i="utf8"),!a.isEncoding(i))throw TypeError("Unknown encoding: "+i);var o=0|h(n,i),l=s(o),c=l.write(n,i);return c!==o&&(l=l.slice(0,c)),l}if(ArrayBuffer.isView(e))return u(e);if(null==e)throw TypeError("The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type "+typeof e);if(B(e,ArrayBuffer)||e&&B(e.buffer,ArrayBuffer)||"u">typeof SharedArrayBuffer&&(B(e,SharedArrayBuffer)||e&&B(e.buffer,SharedArrayBuffer)))return function(e,t,r){var n;if(t<0||e.byteLength<t)throw RangeError('"offset" is outside of buffer bounds');if(e.byteLength<t+(r||0))throw RangeError('"length" is outside of buffer bounds');return Object.setPrototypeOf(n=void 0===t&&void 0===r?new Uint8Array(e):void 0===r?new Uint8Array(e,t):new Uint8Array(e,t,r),a.prototype),n}(e,t,r);if("number"==typeof e)throw TypeError('The "value" argument must not be of type number. Received type number');var f=e.valueOf&&e.valueOf();if(null!=f&&f!==e)return a.from(f,t,r);var p=function(e){if(a.isBuffer(e)){var t=0|d(e.length),r=s(t);return 0===r.length||e.copy(r,0,0,t),r}return void 0!==e.length?"number"!=typeof e.length||function(e){return e!=e}(e.length)?s(0):u(e):"Buffer"===e.type&&Array.isArray(e.data)?u(e.data):void 0}(e);if(p)return p;if("u">typeof Symbol&&null!=Symbol.toPrimitive&&"function"==typeof e[Symbol.toPrimitive])return a.from(e[Symbol.toPrimitive]("string"),t,r);throw TypeError("The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type "+typeof e)}function c(e){if("number"!=typeof e)throw TypeError('"size" argument must be of type number');if(e<0)throw RangeError('The value "'+e+'" is invalid for option "size"')}function f(e){return c(e),s(e<0?0:0|d(e))}function u(e){for(var t=e.length<0?0:0|d(e.length),r=s(t),n=0;n<t;n+=1)r[n]=255&e[n];return r}t.Buffer=a,t.SlowBuffer=function(e){return+e!=e&&(e=0),a.alloc(+e)},t.INSPECT_MAX_BYTES=50,t.kMaxLength=0x7fffffff,a.TYPED_ARRAY_SUPPORT=function(){try{var e=new Uint8Array(1),t={foo:function(){return 42}};return Object.setPrototypeOf(t,Uint8Array.prototype),Object.setPrototypeOf(e,t),42===e.foo()}catch(e){return!1}}(),!a.TYPED_ARRAY_SUPPORT&&"u">typeof console&&"function"==typeof console.error&&console.error("This browser lacks typed array (Uint8Array) support which is required by `buffer` v5.x. Use `buffer` v4.x if you require old browser support."),Object.defineProperty(a.prototype,"parent",{enumerable:!0,get:function(){if(a.isBuffer(this))return this.buffer}}),Object.defineProperty(a.prototype,"offset",{enumerable:!0,get:function(){if(a.isBuffer(this))return this.byteOffset}}),a.poolSize=8192,a.from=function(e,t,r){return l(e,t,r)},Object.setPrototypeOf(a.prototype,Uint8Array.prototype),Object.setPrototypeOf(a,Uint8Array),a.alloc=function(e,t,r){return(c(e),e<=0)?s(e):void 0!==t?"string"==typeof r?s(e).fill(t,r):s(e).fill(t):s(e)},a.allocUnsafe=function(e){return f(e)},a.allocUnsafeSlow=function(e){return f(e)};function d(e){if(e>=0x7fffffff)throw RangeError("Attempt to allocate Buffer larger than maximum size: 0x7fffffff bytes");return 0|e}function h(e,t){if(a.isBuffer(e))return e.length;if(ArrayBuffer.isView(e)||B(e,ArrayBuffer))return e.byteLength;if("string"!=typeof e)throw TypeError('The "string" argument must be one of type string, Buffer, or ArrayBuffer. Received type '+typeof e);var r=e.length,n=arguments.length>2&&!0===arguments[2];if(!n&&0===r)return 0;for(var i=!1;;)switch(t){case"ascii":case"latin1":case"binary":return r;case"utf8":case"utf-8":return k(e).length;case"ucs2":case"ucs-2":case"utf16le":case"utf-16le":return 2*r;case"hex":return r>>>1;case"base64":return S(e).length;default:if(i)return n?-1:k(e).length;t=(""+t).toLowerCase(),i=!0}}function p(e,t,r){var i,o,s,a=!1;if((void 0===t||t<0)&&(t=0),t>this.length||((void 0===r||r>this.length)&&(r=this.length),r<=0||(r>>>=0)<=(t>>>=0)))return"";for(e||(e="utf8");;)switch(e){case"hex":return function(e,t,r){var n=e.length;(!t||t<0)&&(t=0),(!r||r<0||r>n)&&(r=n);for(var i="",o=t;o<r;++o)i+=C[e[o]];return i}(this,t,r);case"utf8":case"utf-8":return y(this,t,r);case"ascii":return function(e,t,r){var n="";r=Math.min(e.length,r);for(var i=t;i<r;++i)n+=String.fromCharCode(127&e[i]);return n}(this,t,r);case"latin1":case"binary":return function(e,t,r){var n="";r=Math.min(e.length,r);for(var i=t;i<r;++i)n+=String.fromCharCode(e[i]);return n}(this,t,r);case"base64":return i=this,o=t,s=r,0===o&&s===i.length?n.fromByteArray(i):n.fromByteArray(i.slice(o,s));case"ucs2":case"ucs-2":case"utf16le":case"utf-16le":return function(e,t,r){for(var n=e.slice(t,r),i="",o=0;o<n.length;o+=2)i+=String.fromCharCode(n[o]+256*n[o+1]);return i}(this,t,r);default:if(a)throw TypeError("Unknown encoding: "+e);e=(e+"").toLowerCase(),a=!0}}function g(e,t,r){var n=e[t];e[t]=e[r],e[r]=n}function m(e,t,r,n,i){var o;if(0===e.length)return -1;if("string"==typeof r?(n=r,r=0):r>0x7fffffff?r=0x7fffffff:r<-0x80000000&&(r=-0x80000000),(o=r*=1)!=o&&(r=i?0:e.length-1),r<0&&(r=e.length+r),r>=e.length)if(i)return -1;else r=e.length-1;else if(r<0)if(!i)return -1;else r=0;if("string"==typeof t&&(t=a.from(t,n)),a.isBuffer(t))return 0===t.length?-1:x(e,t,r,n,i);if("number"==typeof t){if(t&=255,"function"==typeof Uint8Array.prototype.indexOf)if(i)return Uint8Array.prototype.indexOf.call(e,t,r);else return Uint8Array.prototype.lastIndexOf.call(e,t,r);return x(e,[t],r,n,i)}throw TypeError("val must be string, number or Buffer")}function x(e,t,r,n,i){var o,s=1,a=e.length,l=t.length;if(void 0!==n&&("ucs2"===(n=String(n).toLowerCase())||"ucs-2"===n||"utf16le"===n||"utf-16le"===n)){if(e.length<2||t.length<2)return -1;s=2,a/=2,l/=2,r/=2}function c(e,t){return 1===s?e[t]:e.readUInt16BE(t*s)}if(i){var f=-1;for(o=r;o<a;o++)if(c(e,o)===c(t,-1===f?0:o-f)){if(-1===f&&(f=o),o-f+1===l)return f*s}else -1!==f&&(o-=o-f),f=-1}else for(r+l>a&&(r=a-l),o=r;o>=0;o--){for(var u=!0,d=0;d<l;d++)if(c(e,o+d)!==c(t,d)){u=!1;break}if(u)return o}return -1}a.isBuffer=function(e){return null!=e&&!0===e._isBuffer&&e!==a.prototype},a.compare=function(e,t){if(B(e,Uint8Array)&&(e=a.from(e,e.offset,e.byteLength)),B(t,Uint8Array)&&(t=a.from(t,t.offset,t.byteLength)),!a.isBuffer(e)||!a.isBuffer(t))throw TypeError('The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array');if(e===t)return 0;for(var r=e.length,n=t.length,i=0,o=Math.min(r,n);i<o;++i)if(e[i]!==t[i]){r=e[i],n=t[i];break}return r<n?-1:+(n<r)},a.isEncoding=function(e){switch(String(e).toLowerCase()){case"hex":case"utf8":case"utf-8":case"ascii":case"latin1":case"binary":case"base64":case"ucs2":case"ucs-2":case"utf16le":case"utf-16le":return!0;default:return!1}},a.concat=function(e,t){if(!Array.isArray(e))throw TypeError('"list" argument must be an Array of Buffers');if(0===e.length)return a.alloc(0);if(void 0===t)for(r=0,t=0;r<e.length;++r)t+=e[r].length;var r,n=a.allocUnsafe(t),i=0;for(r=0;r<e.length;++r){var o=e[r];if(B(o,Uint8Array)&&(o=a.from(o)),!a.isBuffer(o))throw TypeError('"list" argument must be an Array of Buffers');o.copy(n,i),i+=o.length}return n},a.byteLength=h,a.prototype._isBuffer=!0,a.prototype.swap16=function(){var e=this.length;if(e%2!=0)throw RangeError("Buffer size must be a multiple of 16-bits");for(var t=0;t<e;t+=2)g(this,t,t+1);return this},a.prototype.swap32=function(){var e=this.length;if(e%4!=0)throw RangeError("Buffer size must be a multiple of 32-bits");for(var t=0;t<e;t+=4)g(this,t,t+3),g(this,t+1,t+2);return this},a.prototype.swap64=function(){var e=this.length;if(e%8!=0)throw RangeError("Buffer size must be a multiple of 64-bits");for(var t=0;t<e;t+=8)g(this,t,t+7),g(this,t+1,t+6),g(this,t+2,t+5),g(this,t+3,t+4);return this},a.prototype.toString=function(){var e=this.length;return 0===e?"":0==arguments.length?y(this,0,e):p.apply(this,arguments)},a.prototype.toLocaleString=a.prototype.toString,a.prototype.equals=function(e){if(!a.isBuffer(e))throw TypeError("Argument must be a Buffer");return this===e||0===a.compare(this,e)},a.prototype.inspect=function(){var e="",r=t.INSPECT_MAX_BYTES;return e=this.toString("hex",0,r).replace(/(.{2})/g,"$1 ").trim(),this.length>r&&(e+=" ... "),"<Buffer "+e+">"},o&&(a.prototype[o]=a.prototype.inspect),a.prototype.compare=function(e,t,r,n,i){if(B(e,Uint8Array)&&(e=a.from(e,e.offset,e.byteLength)),!a.isBuffer(e))throw TypeError('The "target" argument must be one of type Buffer or Uint8Array. Received type '+typeof e);if(void 0===t&&(t=0),void 0===r&&(r=e?e.length:0),void 0===n&&(n=0),void 0===i&&(i=this.length),t<0||r>e.length||n<0||i>this.length)throw RangeError("out of range index");if(n>=i&&t>=r)return 0;if(n>=i)return -1;if(t>=r)return 1;if(t>>>=0,r>>>=0,n>>>=0,i>>>=0,this===e)return 0;for(var o=i-n,s=r-t,l=Math.min(o,s),c=this.slice(n,i),f=e.slice(t,r),u=0;u<l;++u)if(c[u]!==f[u]){o=c[u],s=f[u];break}return o<s?-1:+(s<o)},a.prototype.includes=function(e,t,r){return -1!==this.indexOf(e,t,r)},a.prototype.indexOf=function(e,t,r){return m(this,e,t,r,!0)},a.prototype.lastIndexOf=function(e,t,r){return m(this,e,t,r,!1)};function y(e,t,r){r=Math.min(e.length,r);for(var n=[],i=t;i<r;){var o,s,a,l,c=e[i],f=null,u=c>239?4:c>223?3:c>191?2:1;if(i+u<=r)switch(u){case 1:c<128&&(f=c);break;case 2:(192&(o=e[i+1]))==128&&(l=(31&c)<<6|63&o)>127&&(f=l);break;case 3:o=e[i+1],s=e[i+2],(192&o)==128&&(192&s)==128&&(l=(15&c)<<12|(63&o)<<6|63&s)>2047&&(l<55296||l>57343)&&(f=l);break;case 4:o=e[i+1],s=e[i+2],a=e[i+3],(192&o)==128&&(192&s)==128&&(192&a)==128&&(l=(15&c)<<18|(63&o)<<12|(63&s)<<6|63&a)>65535&&l<1114112&&(f=l)}null===f?(f=65533,u=1):f>65535&&(f-=65536,n.push(f>>>10&1023|55296),f=56320|1023&f),n.push(f),i+=u}var d=n,h=d.length;if(h<=4096)return String.fromCharCode.apply(String,d);for(var p="",g=0;g<h;)p+=String.fromCharCode.apply(String,d.slice(g,g+=4096));return p}function b(e,t,r){if(e%1!=0||e<0)throw RangeError("offset is not uint");if(e+t>r)throw RangeError("Trying to access beyond buffer length")}function v(e,t,r,n,i,o){if(!a.isBuffer(e))throw TypeError('"buffer" argument must be a Buffer instance');if(t>i||t<o)throw RangeError('"value" argument is out of bounds');if(r+n>e.length)throw RangeError("Index out of range")}function w(e,t,r,n,i,o){if(r+n>e.length||r<0)throw RangeError("Index out of range")}function j(e,t,r,n,o){return t*=1,r>>>=0,o||w(e,t,r,4,34028234663852886e22,-34028234663852886e22),i.write(e,t,r,n,23,4),r+4}function N(e,t,r,n,o){return t*=1,r>>>=0,o||w(e,t,r,8,17976931348623157e292,-17976931348623157e292),i.write(e,t,r,n,52,8),r+8}a.prototype.write=function(e,t,r,n){if(void 0===t)n="utf8",r=this.length,t=0;else if(void 0===r&&"string"==typeof t)n=t,r=this.length,t=0;else if(isFinite(t))t>>>=0,isFinite(r)?(r>>>=0,void 0===n&&(n="utf8")):(n=r,r=void 0);else throw Error("Buffer.write(string, encoding, offset[, length]) is no longer supported");var i,o,s,a,l,c,f,u,d=this.length-t;if((void 0===r||r>d)&&(r=d),e.length>0&&(r<0||t<0)||t>this.length)throw RangeError("Attempt to write outside buffer bounds");n||(n="utf8");for(var h=!1;;)switch(n){case"hex":return function(e,t,r,n){r=Number(r)||0;var i=e.length-r;n?(n=Number(n))>i&&(n=i):n=i;var o=t.length;n>o/2&&(n=o/2);for(var s=0;s<n;++s){var a,l=parseInt(t.substr(2*s,2),16);if((a=l)!=a)break;e[r+s]=l}return s}(this,e,t,r);case"utf8":case"utf-8":return i=t,o=r,_(k(e,this.length-i),this,i,o);case"ascii":return s=t,a=r,_(E(e),this,s,a);case"latin1":case"binary":return function(e,t,r,n){return _(E(t),e,r,n)}(this,e,t,r);case"base64":return l=t,c=r,_(S(e),this,l,c);case"ucs2":case"ucs-2":case"utf16le":case"utf-16le":return f=t,u=r,_(function(e,t){for(var r,n,i=[],o=0;o<e.length&&!((t-=2)<0);++o)n=(r=e.charCodeAt(o))>>8,i.push(r%256),i.push(n);return i}(e,this.length-f),this,f,u);default:if(h)throw TypeError("Unknown encoding: "+n);n=(""+n).toLowerCase(),h=!0}},a.prototype.toJSON=function(){return{type:"Buffer",data:Array.prototype.slice.call(this._arr||this,0)}},a.prototype.slice=function(e,t){var r=this.length;e=~~e,t=void 0===t?r:~~t,e<0?(e+=r)<0&&(e=0):e>r&&(e=r),t<0?(t+=r)<0&&(t=0):t>r&&(t=r),t<e&&(t=e);var n=this.subarray(e,t);return Object.setPrototypeOf(n,a.prototype),n},a.prototype.readUIntLE=function(e,t,r){e>>>=0,t>>>=0,r||b(e,t,this.length);for(var n=this[e],i=1,o=0;++o<t&&(i*=256);)n+=this[e+o]*i;return n},a.prototype.readUIntBE=function(e,t,r){e>>>=0,t>>>=0,r||b(e,t,this.length);for(var n=this[e+--t],i=1;t>0&&(i*=256);)n+=this[e+--t]*i;return n},a.prototype.readUInt8=function(e,t){return e>>>=0,t||b(e,1,this.length),this[e]},a.prototype.readUInt16LE=function(e,t){return e>>>=0,t||b(e,2,this.length),this[e]|this[e+1]<<8},a.prototype.readUInt16BE=function(e,t){return e>>>=0,t||b(e,2,this.length),this[e]<<8|this[e+1]},a.prototype.readUInt32LE=function(e,t){return e>>>=0,t||b(e,4,this.length),(this[e]|this[e+1]<<8|this[e+2]<<16)+0x1000000*this[e+3]},a.prototype.readUInt32BE=function(e,t){return e>>>=0,t||b(e,4,this.length),0x1000000*this[e]+(this[e+1]<<16|this[e+2]<<8|this[e+3])},a.prototype.readIntLE=function(e,t,r){e>>>=0,t>>>=0,r||b(e,t,this.length);for(var n=this[e],i=1,o=0;++o<t&&(i*=256);)n+=this[e+o]*i;return n>=(i*=128)&&(n-=Math.pow(2,8*t)),n},a.prototype.readIntBE=function(e,t,r){e>>>=0,t>>>=0,r||b(e,t,this.length);for(var n=t,i=1,o=this[e+--n];n>0&&(i*=256);)o+=this[e+--n]*i;return o>=(i*=128)&&(o-=Math.pow(2,8*t)),o},a.prototype.readInt8=function(e,t){return(e>>>=0,t||b(e,1,this.length),128&this[e])?-((255-this[e]+1)*1):this[e]},a.prototype.readInt16LE=function(e,t){e>>>=0,t||b(e,2,this.length);var r=this[e]|this[e+1]<<8;return 32768&r?0xffff0000|r:r},a.prototype.readInt16BE=function(e,t){e>>>=0,t||b(e,2,this.length);var r=this[e+1]|this[e]<<8;return 32768&r?0xffff0000|r:r},a.prototype.readInt32LE=function(e,t){return e>>>=0,t||b(e,4,this.length),this[e]|this[e+1]<<8|this[e+2]<<16|this[e+3]<<24},a.prototype.readInt32BE=function(e,t){return e>>>=0,t||b(e,4,this.length),this[e]<<24|this[e+1]<<16|this[e+2]<<8|this[e+3]},a.prototype.readFloatLE=function(e,t){return e>>>=0,t||b(e,4,this.length),i.read(this,e,!0,23,4)},a.prototype.readFloatBE=function(e,t){return e>>>=0,t||b(e,4,this.length),i.read(this,e,!1,23,4)},a.prototype.readDoubleLE=function(e,t){return e>>>=0,t||b(e,8,this.length),i.read(this,e,!0,52,8)},a.prototype.readDoubleBE=function(e,t){return e>>>=0,t||b(e,8,this.length),i.read(this,e,!1,52,8)},a.prototype.writeUIntLE=function(e,t,r,n){if(e*=1,t>>>=0,r>>>=0,!n){var i=Math.pow(2,8*r)-1;v(this,e,t,r,i,0)}var o=1,s=0;for(this[t]=255&e;++s<r&&(o*=256);)this[t+s]=e/o&255;return t+r},a.prototype.writeUIntBE=function(e,t,r,n){if(e*=1,t>>>=0,r>>>=0,!n){var i=Math.pow(2,8*r)-1;v(this,e,t,r,i,0)}var o=r-1,s=1;for(this[t+o]=255&e;--o>=0&&(s*=256);)this[t+o]=e/s&255;return t+r},a.prototype.writeUInt8=function(e,t,r){return e*=1,t>>>=0,r||v(this,e,t,1,255,0),this[t]=255&e,t+1},a.prototype.writeUInt16LE=function(e,t,r){return e*=1,t>>>=0,r||v(this,e,t,2,65535,0),this[t]=255&e,this[t+1]=e>>>8,t+2},a.prototype.writeUInt16BE=function(e,t,r){return e*=1,t>>>=0,r||v(this,e,t,2,65535,0),this[t]=e>>>8,this[t+1]=255&e,t+2},a.prototype.writeUInt32LE=function(e,t,r){return e*=1,t>>>=0,r||v(this,e,t,4,0xffffffff,0),this[t+3]=e>>>24,this[t+2]=e>>>16,this[t+1]=e>>>8,this[t]=255&e,t+4},a.prototype.writeUInt32BE=function(e,t,r){return e*=1,t>>>=0,r||v(this,e,t,4,0xffffffff,0),this[t]=e>>>24,this[t+1]=e>>>16,this[t+2]=e>>>8,this[t+3]=255&e,t+4},a.prototype.writeIntLE=function(e,t,r,n){if(e*=1,t>>>=0,!n){var i=Math.pow(2,8*r-1);v(this,e,t,r,i-1,-i)}var o=0,s=1,a=0;for(this[t]=255&e;++o<r&&(s*=256);)e<0&&0===a&&0!==this[t+o-1]&&(a=1),this[t+o]=(e/s|0)-a&255;return t+r},a.prototype.writeIntBE=function(e,t,r,n){if(e*=1,t>>>=0,!n){var i=Math.pow(2,8*r-1);v(this,e,t,r,i-1,-i)}var o=r-1,s=1,a=0;for(this[t+o]=255&e;--o>=0&&(s*=256);)e<0&&0===a&&0!==this[t+o+1]&&(a=1),this[t+o]=(e/s|0)-a&255;return t+r},a.prototype.writeInt8=function(e,t,r){return e*=1,t>>>=0,r||v(this,e,t,1,127,-128),e<0&&(e=255+e+1),this[t]=255&e,t+1},a.prototype.writeInt16LE=function(e,t,r){return e*=1,t>>>=0,r||v(this,e,t,2,32767,-32768),this[t]=255&e,this[t+1]=e>>>8,t+2},a.prototype.writeInt16BE=function(e,t,r){return e*=1,t>>>=0,r||v(this,e,t,2,32767,-32768),this[t]=e>>>8,this[t+1]=255&e,t+2},a.prototype.writeInt32LE=function(e,t,r){return e*=1,t>>>=0,r||v(this,e,t,4,0x7fffffff,-0x80000000),this[t]=255&e,this[t+1]=e>>>8,this[t+2]=e>>>16,this[t+3]=e>>>24,t+4},a.prototype.writeInt32BE=function(e,t,r){return e*=1,t>>>=0,r||v(this,e,t,4,0x7fffffff,-0x80000000),e<0&&(e=0xffffffff+e+1),this[t]=e>>>24,this[t+1]=e>>>16,this[t+2]=e>>>8,this[t+3]=255&e,t+4},a.prototype.writeFloatLE=function(e,t,r){return j(this,e,t,!0,r)},a.prototype.writeFloatBE=function(e,t,r){return j(this,e,t,!1,r)},a.prototype.writeDoubleLE=function(e,t,r){return N(this,e,t,!0,r)},a.prototype.writeDoubleBE=function(e,t,r){return N(this,e,t,!1,r)},a.prototype.copy=function(e,t,r,n){if(!a.isBuffer(e))throw TypeError("argument should be a Buffer");if(r||(r=0),n||0===n||(n=this.length),t>=e.length&&(t=e.length),t||(t=0),n>0&&n<r&&(n=r),n===r||0===e.length||0===this.length)return 0;if(t<0)throw RangeError("targetStart out of bounds");if(r<0||r>=this.length)throw RangeError("Index out of range");if(n<0)throw RangeError("sourceEnd out of bounds");n>this.length&&(n=this.length),e.length-t<n-r&&(n=e.length-t+r);var i=n-r;if(this===e&&"function"==typeof Uint8Array.prototype.copyWithin)this.copyWithin(t,r,n);else if(this===e&&r<t&&t<n)for(var o=i-1;o>=0;--o)e[o+t]=this[o+r];else Uint8Array.prototype.set.call(e,this.subarray(r,n),t);return i},a.prototype.fill=function(e,t,r,n){if("string"==typeof e){if("string"==typeof t?(n=t,t=0,r=this.length):"string"==typeof r&&(n=r,r=this.length),void 0!==n&&"string"!=typeof n)throw TypeError("encoding must be a string");if("string"==typeof n&&!a.isEncoding(n))throw TypeError("Unknown encoding: "+n);if(1===e.length){var i,o=e.charCodeAt(0);("utf8"===n&&o<128||"latin1"===n)&&(e=o)}}else"number"==typeof e?e&=255:"boolean"==typeof e&&(e=Number(e));if(t<0||this.length<t||this.length<r)throw RangeError("Out of range index");if(r<=t)return this;if(t>>>=0,r=void 0===r?this.length:r>>>0,e||(e=0),"number"==typeof e)for(i=t;i<r;++i)this[i]=e;else{var s=a.isBuffer(e)?e:a.from(e,n),l=s.length;if(0===l)throw TypeError('The value "'+e+'" is invalid for argument "value"');for(i=0;i<r-t;++i)this[i+t]=s[i%l]}return this};var A=/[^+/0-9A-Za-z-_]/g;function k(e,t){t=t||1/0;for(var r,n=e.length,i=null,o=[],s=0;s<n;++s){if((r=e.charCodeAt(s))>55295&&r<57344){if(!i){if(r>56319||s+1===n){(t-=3)>-1&&o.push(239,191,189);continue}i=r;continue}if(r<56320){(t-=3)>-1&&o.push(239,191,189),i=r;continue}r=(i-55296<<10|r-56320)+65536}else i&&(t-=3)>-1&&o.push(239,191,189);if(i=null,r<128){if((t-=1)<0)break;o.push(r)}else if(r<2048){if((t-=2)<0)break;o.push(r>>6|192,63&r|128)}else if(r<65536){if((t-=3)<0)break;o.push(r>>12|224,r>>6&63|128,63&r|128)}else if(r<1114112){if((t-=4)<0)break;o.push(r>>18|240,r>>12&63|128,r>>6&63|128,63&r|128)}else throw Error("Invalid code point")}return o}function E(e){for(var t=[],r=0;r<e.length;++r)t.push(255&e.charCodeAt(r));return t}function S(e){return n.toByteArray(function(e){if((e=(e=e.split("=")[0]).trim().replace(A,"")).length<2)return"";for(;e.length%4!=0;)e+="=";return e}(e))}function _(e,t,r,n){for(var i=0;i<n&&!(i+r>=t.length)&&!(i>=e.length);++i)t[i+r]=e[i];return i}function B(e,t){return e instanceof t||null!=e&&null!=e.constructor&&null!=e.constructor.name&&e.constructor.name===t.name}var C=function(){for(var e="0123456789abcdef",t=Array(256),r=0;r<16;++r)for(var n=16*r,i=0;i<16;++i)t[n+i]=e[r]+e[i];return t}()},783:function(e,t){t.read=function(e,t,r,n,i){var o,s,a=8*i-n-1,l=(1<<a)-1,c=l>>1,f=-7,u=r?i-1:0,d=r?-1:1,h=e[t+u];for(u+=d,o=h&(1<<-f)-1,h>>=-f,f+=a;f>0;o=256*o+e[t+u],u+=d,f-=8);for(s=o&(1<<-f)-1,o>>=-f,f+=n;f>0;s=256*s+e[t+u],u+=d,f-=8);if(0===o)o=1-c;else{if(o===l)return s?NaN:1/0*(h?-1:1);s+=Math.pow(2,n),o-=c}return(h?-1:1)*s*Math.pow(2,o-n)},t.write=function(e,t,r,n,i,o){var s,a,l,c=8*o-i-1,f=(1<<c)-1,u=f>>1,d=5960464477539062e-23*(23===i),h=n?0:o-1,p=n?1:-1,g=+(t<0||0===t&&1/t<0);for(isNaN(t=Math.abs(t))||t===1/0?(a=+!!isNaN(t),s=f):(s=Math.floor(Math.log(t)/Math.LN2),t*(l=Math.pow(2,-s))<1&&(s--,l*=2),s+u>=1?t+=d/l:t+=d*Math.pow(2,1-u),t*l>=2&&(s++,l/=2),s+u>=f?(a=0,s=f):s+u>=1?(a=(t*l-1)*Math.pow(2,i),s+=u):(a=t*Math.pow(2,u-1)*Math.pow(2,i),s=0));i>=8;e[r+h]=255&a,h+=p,a/=256,i-=8);for(s=s<<i|a,c+=i;c>0;e[r+h]=255&s,h+=p,s/=256,c-=8);e[r+h-p]|=128*g}}},i={};function o(e){var t=i[e];if(void 0!==t)return t.exports;var r=i[e]={exports:{}},s=!0;try{n[e](r,r.exports,o),s=!1}finally{s&&delete i[e]}return r.exports}o.ab="/ROOT/node_modules/next/dist/compiled/buffer/",t.exports=o(72)},18566,(e,t,r)=>{t.exports=e.r(76562)},53051,53845,e=>{"use strict";var t=e.i(7471);let r=t.supabase,n={document_created:"문서 생성",signing_requested:"서명 요청",email_sent:"이메일 발송",document_opened:"문서 열람",document_viewed:"문서 확인",signature_drawn:"서명 입력 (직접 그리기)",signature_typed:"서명 입력 (텍스트)",signature_submitted:"서명 제출",document_completed:"서명 완료",document_locked:"문서 잠금"};async function i(e,t){let{data:n,error:i}=await r.from("hr_contract_packages").select("id, notes").eq("id",e).single();if(i)throw Error(`감사추적 기록 실패 — 패키지 조회 오류: ${i.message}`);if(!n)throw Error(`감사추적 기록 실패 — 패키지를 찾을 수 없습니다: ${e}`);let o={};if(n.notes)try{let e=JSON.parse(n.notes);o="object"!=typeof e||null===e||Array.isArray(e)?Array.isArray(e)?{audit_trail:e}:{text:String(e)}:e}catch{o={text:n.notes}}let s=Array.isArray(o.audit_trail)?o.audit_trail:[];s.push({action:t.action,timestamp:t.timestamp||new Date().toISOString(),actor:t.actor,...t.ip?{ip:t.ip}:{},...t.userAgent?{userAgent:t.userAgent}:{},...t.details?{details:t.details}:{}}),o.audit_trail=s;let{error:a}=await r.from("hr_contract_packages").update({notes:JSON.stringify(o)}).eq("id",e);if(a)throw Error(`감사추적 기록 실패 — DB 업데이트 오류: ${a.message}`)}async function o(e){let{data:t,error:n}=await r.from("hr_contract_packages").select("notes").eq("id",e).single();if(n)throw Error(`감사추적 조회 실패: ${n.message}`);if(!t?.notes)return[];try{let e=JSON.parse(t.notes);if(Array.isArray(e))return e;if("object"==typeof e&&null!==e&&Array.isArray(e.audit_trail))return e.audit_trail}catch{}return[]}function s(e){let{packageTitle:t,companyName:r,employeeName:i,signerEmail:o,documentNames:s,auditEntries:a,documentHash:l}=e,c=new Date().toLocaleString("ko-KR",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:!1}),f=e=>e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"),u=a.map((e,t)=>`
      <tr${t%2==1?' class="alt"':""}>
        <td class="seq">${t+1}</td>
        <td class="ts">${f((e=>{try{return new Date(e).toLocaleString("ko-KR",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:!1})}catch{return e}})(e.timestamp))}</td>
        <td class="action">${f(n[e.action]||e.action)}</td>
        <td class="actor">${f(e.actor)}</td>
        <td class="ip">${e.ip?f(e.ip):"-"}</td>
        <td class="details">${e.details?f(e.details):"-"}</td>
      </tr>`).join("\n"),d=s.map((e,t)=>`<li>${t+1}. ${f(e)}</li>`).join("\n");return`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>감사추적인증서 — ${f(t)}</title>
  <style>
    @page {
      size: A4;
      margin: 20mm 15mm;
    }

    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .no-print { display: none !important; }
      .page-break { page-break-before: always; }
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI',
                   'Noto Sans KR', sans-serif;
      font-size: 11px;
      color: #1a1a1a;
      line-height: 1.6;
      background: #f5f5f5;
    }

    .certificate {
      max-width: 210mm;
      margin: 0 auto;
      background: #fff;
      padding: 40px 36px;
    }

    /* ── Header ── */
    .header {
      text-align: center;
      border-bottom: 3px double #1a1a1a;
      padding-bottom: 20px;
      margin-bottom: 28px;
    }

    .header h1 {
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.5px;
      margin-bottom: 4px;
    }

    .header .subtitle {
      font-size: 13px;
      color: #666;
      font-weight: 400;
    }

    /* ── Section ── */
    .section {
      margin-bottom: 24px;
    }

    .section-title {
      font-size: 13px;
      font-weight: 700;
      color: #1a1a1a;
      border-left: 4px solid #2563eb;
      padding-left: 10px;
      margin-bottom: 12px;
    }

    /* ── Info Grid ── */
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px 24px;
    }

    .info-row {
      display: flex;
      gap: 8px;
    }

    .info-label {
      font-weight: 600;
      color: #555;
      min-width: 80px;
      flex-shrink: 0;
    }

    .info-value {
      color: #1a1a1a;
      word-break: break-all;
    }

    /* ── Document List ── */
    .doc-list {
      list-style: none;
      padding: 0;
    }

    .doc-list li {
      padding: 6px 12px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      margin-bottom: 4px;
      font-size: 11px;
    }

    /* ── Timeline Table ── */
    .timeline-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10px;
    }

    .timeline-table th {
      background: #1e293b;
      color: #fff;
      padding: 8px 6px;
      text-align: left;
      font-weight: 600;
      font-size: 10px;
    }

    .timeline-table th:first-child { border-radius: 6px 0 0 0; }
    .timeline-table th:last-child { border-radius: 0 6px 0 0; }

    .timeline-table td {
      padding: 7px 6px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: top;
    }

    .timeline-table tr.alt td {
      background: #f8fafc;
    }

    .timeline-table .seq { width: 30px; text-align: center; color: #94a3b8; }
    .timeline-table .ts { width: 140px; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .timeline-table .action { width: 140px; font-weight: 600; color: #1e40af; }
    .timeline-table .actor { width: 120px; }
    .timeline-table .ip { width: 110px; color: #64748b; font-family: monospace; font-size: 10px; }
    .timeline-table .details { color: #475569; }

    /* ── Hash Section ── */
    .hash-box {
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 14px 16px;
    }

    .hash-label {
      font-size: 10px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }

    .hash-value {
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 11px;
      color: #1e293b;
      word-break: break-all;
      line-height: 1.5;
    }

    /* ── Footer ── */
    .footer {
      margin-top: 36px;
      padding-top: 20px;
      border-top: 2px solid #e2e8f0;
      text-align: center;
    }

    .legal-notice {
      font-size: 11px;
      color: #475569;
      font-weight: 500;
      margin-bottom: 8px;
    }

    .generated-at {
      font-size: 10px;
      color: #94a3b8;
    }

    .system-name {
      font-size: 10px;
      color: #94a3b8;
      margin-top: 4px;
    }
  </style>
</head>
<body>
  <div class="certificate">
    <!-- Header -->
    <div class="header">
      <h1>감사추적인증서</h1>
      <div class="subtitle">Audit Trail Certificate</div>
    </div>

    <!-- Document Info -->
    <div class="section">
      <div class="section-title">문서 정보</div>
      <div class="info-grid">
        <div class="info-row">
          <span class="info-label">계약명</span>
          <span class="info-value">${f(t)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">회사명</span>
          <span class="info-value">${f(r)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">서명자</span>
          <span class="info-value">${f(i)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">이메일</span>
          <span class="info-value">${f(o)}</span>
        </div>
        <div class="info-row" style="grid-column: span 2;">
          <span class="info-label">문서 수</span>
          <span class="info-value">${s.length}건</span>
        </div>
      </div>
    </div>

    <!-- Document List -->
    <div class="section">
      <div class="section-title">포함 문서</div>
      <ul class="doc-list">
        ${d}
      </ul>
    </div>

    <!-- Audit Timeline -->
    <div class="section">
      <div class="section-title">감사 추적 이력</div>
      <table class="timeline-table">
        <thead>
          <tr>
            <th>#</th>
            <th>일시</th>
            <th>활동</th>
            <th>수행자</th>
            <th>IP 주소</th>
            <th>상세</th>
          </tr>
        </thead>
        <tbody>
          ${u}
        </tbody>
      </table>
    </div>

    <!-- Document Integrity -->
    <div class="section">
      <div class="section-title">문서 무결성 검증</div>
      <div class="hash-box">
        <div class="hash-label">SHA-256 해시값</div>
        <div class="hash-value">${f(l)}</div>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <p class="legal-notice">
        본 인증서는 전자서명법 제3조에 따라 전자서명의 진정성을 증명합니다
      </p>
      <p class="generated-at">생성일시: ${f(c)}</p>
      <p class="system-name">OwnerView 전자서명 시스템</p>
    </div>
  </div>
</body>
</html>`}e.s(["generateAuditTrailCertificateHTML",()=>s,"getAuditTrail",()=>o,"logAuditTrail",()=>i],53051);let a=t.supabase;async function l(e){let t=new TextEncoder().encode(e);return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",t))).map(e=>e.toString(16).padStart(2,"0")).join("")}async function c(e){let{data:t,error:r}=await a.from("hr_contract_package_items").select("id, sort_order, signature_data, documents(content_json)").eq("package_id",e).order("sort_order");if(r)throw Error(`패키지 아이템 조회 실패: ${r.message}`);if(!t||0===t.length)throw Error("패키지에 문서가 없습니다");let n=[];for(let e of t)e.documents?.content_json&&n.push(JSON.stringify(e.documents.content_json)),e.signature_data&&n.push(JSON.stringify(e.signature_data));return l(n.join("|"))}async function f(e,t){let{data:r,error:n}=await a.from("hr_contract_packages").select("notes").eq("id",e).single();if(n)throw Error(`패키지 조회 실패: ${n.message}`);let i={};if(r?.notes)try{i=JSON.parse(r.notes)}catch{i={text:r.notes}}i.document_hash=t,i.hash_generated_at=new Date().toISOString();let{error:o}=await a.from("hr_contract_packages").update({notes:JSON.stringify(i)}).eq("id",e);if(o)throw Error(`해시 저장 실패: ${o.message}`)}async function u(e){let{data:t,error:r}=await a.from("hr_contract_packages").select("notes").eq("id",e).single();if(r)throw Error(`패키지 조회 실패: ${r.message}`);let n="";if(t?.notes)try{n=JSON.parse(t.notes).document_hash||""}catch{}if(!n)throw Error("저장된 해시가 없습니다. 먼저 storeDocumentHash를 호출하세요.");let i=await c(e);return{valid:n===i,storedHash:n,currentHash:i}}e.s(["generatePackageHash",()=>c,"storeDocumentHash",()=>f,"verifyDocumentIntegrity",()=>u],53845)},84099,e=>{"use strict";var t=e.i(43476),r=e.i(71645),n=e.i(18566),i=e.i(7471),o=e.i(53051),s=e.i(53845);let a=i.supabase;function l(){return(0,t.jsx)(r.Suspense,{fallback:(0,t.jsx)("div",{className:"min-h-screen flex items-center justify-center bg-gray-50",children:(0,t.jsx)("div",{className:"w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"})}),children:(0,t.jsx)(c,{})})}function c(){let e=(0,n.useSearchParams)().get("token")||"",[i,l]=(0,r.useState)(!0),[c,f]=(0,r.useState)(!1),[u,d]=(0,r.useState)(null),[h,p]=(0,r.useState)(0),[g,m]=(0,r.useState)(null),[x,y]=(0,r.useState)(""),[b,v]=(0,r.useState)(!1),[w,j]=(0,r.useState)(!1),[N,A]=(0,r.useState)(null),[k,E]=(0,r.useState)(null),[S,_]=(0,r.useState)(!1),B=(0,r.useRef)(null),C=(0,r.useRef)(!1);async function T(){try{let{data:t}=await a.from("hr_contract_packages").select("*, employees(name, email, department, position), companies(name)").eq("sign_token",e).single();if(!t){f(!0),l(!1);return}let r=!!t.expires_at&&new Date(t.expires_at)<new Date,{data:n}=await a.from("hr_contract_package_items").select("*, documents(name, content_json, status)").eq("package_id",t.id).order("sort_order");if(d({...t,expired:r,items:n||[]}),t.employee_id){let{data:e}=await a.from("employees").select("saved_signature").eq("id",t.employee_id).single();e?.saved_signature&&A(e.saved_signature)}"completed"===t.status&&j(!0);let i=(n||[]).findIndex(e=>"pending"===e.status);i>=0&&p(i),l(!1);try{(0,o.logAuditTrail)(t.id,{action:"document_opened",timestamp:new Date().toISOString(),actor:t.employees?.name||"unknown",userAgent:navigator.userAgent,details:`서명 페이지 접속`})}catch(e){console.error("Audit log error:",e)}}catch{f(!0),l(!1)}}(0,r.useEffect)(()=>{if(!e){f(!0),l(!1);return}T()},[e]);let O=(0,r.useCallback)(e=>{let t=B.current;if(!t)return;C.current=!0;let r=t.getContext("2d"),n=t.getBoundingClientRect(),i="touches"in e?e.touches[0].clientX-n.left:e.clientX-n.left,o="touches"in e?e.touches[0].clientY-n.top:e.clientY-n.top;r.beginPath(),r.moveTo(i,o)},[]),I=(0,r.useCallback)(e=>{if(!C.current)return;let t=B.current;if(!t)return;let r=t.getContext("2d"),n=t.getBoundingClientRect(),i="touches"in e?e.touches[0].clientX-n.left:e.clientX-n.left,o="touches"in e?e.touches[0].clientY-n.top:e.clientY-n.top;r.lineWidth=2,r.lineCap="round",r.strokeStyle="#1e293b",r.lineTo(i,o),r.stroke()},[]),U=(0,r.useCallback)(()=>{C.current=!1},[]),L=()=>{let e=B.current;e&&e.getContext("2d").clearRect(0,0,e.width,e.height)};async function R(){let e;if(!u)return;let t=u.items[h];if(t&&"signed"!==t.status){if("saved"===g&&N)e=N;else if("draw"===g){let t=B.current;if(!t)return;e={type:"draw",data:t.toDataURL("image/png")}}else{if("type"!==g||!x.trim())return;e={type:"type",data:x.trim()}}v(!0);try{await a.from("hr_contract_package_items").update({status:"signed",signed_at:new Date().toISOString(),signature_data:e}).eq("id",t.id);try{(0,o.logAuditTrail)(u.id,{action:"draw"===e.type?"signature_drawn":"signature_typed",timestamp:new Date().toISOString(),actor:u.employees?.name||"unknown",details:`서명 방식: ${"draw"===e.type?"직접 그리기":"텍스트 입력"}`})}catch(e){console.error("Audit log error:",e)}t.documents&&await a.from("documents").update({status:"locked",locked_at:new Date().toISOString()}).eq("id",t.document_id);let r=u.items.map((e,t)=>t===h?{...e,status:"signed",signed_at:new Date().toISOString()}:e),n=r.every(e=>"signed"===e.status),i=r.some(e=>"signed"===e.status);if(n){await a.from("hr_contract_packages").update({status:"completed",completed_at:new Date().toISOString()}).eq("id",u.id),j(!0);try{let e=await (0,s.generatePackageHash)(u.id);await (0,s.storeDocumentHash)(u.id,e)}catch(e){console.error("Hash generation error:",e)}try{await (0,o.logAuditTrail)(u.id,{action:"document_completed",timestamp:new Date().toISOString(),actor:u.employees?.name||"unknown",details:`전체 ${r.length}건 서명 완료`})}catch(e){console.error("Audit log error:",e)}try{let e="https://njbvdkuvtdtkxyylwngn.supabase.co",t=u.employees?.email||"",n=u.companies?.name||"";e&&t&&await fetch(`${e}/functions/v1/send-contract-email`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({to:t,employeeName:u.employees?.name||"",companyName:n,packageTitle:u.title,documentCount:r.length,signUrl:window.location.href,type:"completion",completedAt:new Date().toISOString()})})}catch(e){console.error("Completion email failed:",e)}}else i&&await a.from("hr_contract_packages").update({status:"partially_signed"}).eq("id",u.id);d({...u,items:r});let l=r.findIndex((e,t)=>t>h&&"pending"===e.status);l>=0&&(p(l),m(null),L(),y(""))}catch(e){alert("서명 처리 중 오류: "+(e.message||"알 수 없는 오류"))}finally{v(!1)}}}if(i)return(0,t.jsx)("div",{className:"min-h-screen flex items-center justify-center bg-gray-50",children:(0,t.jsxs)("div",{className:"text-center",children:[(0,t.jsx)("div",{className:"w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"}),(0,t.jsx)("p",{className:"text-sm text-gray-500",children:"계약서를 불러오는 중..."})]})});if(c||!u)return(0,t.jsx)("div",{className:"min-h-screen flex items-center justify-center px-4 bg-gray-50",children:(0,t.jsxs)("div",{className:"w-full max-w-md text-center",children:[(0,t.jsx)("div",{className:"w-14 h-14 rounded-2xl bg-red-50 text-red-600 text-xl font-black flex items-center justify-center mx-auto mb-4",children:"!"}),(0,t.jsx)("h1",{className:"text-2xl font-extrabold text-gray-900 mb-2",children:"유효하지 않은 링크"}),(0,t.jsx)("p",{className:"text-gray-500 text-sm",children:"서명 링크가 만료되었거나 유효하지 않습니다. 담당자에게 문의해주세요."})]})});if(u.expired)return(0,t.jsx)("div",{className:"min-h-screen flex items-center justify-center px-4 bg-gray-50",children:(0,t.jsxs)("div",{className:"w-full max-w-md text-center",children:[(0,t.jsx)("div",{className:"w-14 h-14 rounded-2xl bg-yellow-50 text-yellow-600 text-xl font-black flex items-center justify-center mx-auto mb-4",children:"!"}),(0,t.jsx)("h1",{className:"text-2xl font-extrabold text-gray-900 mb-2",children:"서명 기한 만료"}),(0,t.jsx)("p",{className:"text-gray-500 text-sm",children:"서명 기한이 만료되었습니다. 회사 담당자에게 재발송을 요청해주세요."})]})});async function M(){if(u)try{let e=await (0,o.getAuditTrail)(u.id),t="N/A";if(u.notes)try{t=JSON.parse(u.notes).document_hash||"N/A"}catch{}try{let{data:e}=await a.from("hr_contract_packages").select("notes").eq("id",u.id).single();if(e?.notes){let r=JSON.parse(e.notes);r.document_hash&&(t=r.document_hash)}}catch{}let r=(0,o.generateAuditTrailCertificateHTML)({packageTitle:u.title,companyName:u.companies?.name||"",employeeName:u.employees?.name||"",signerEmail:u.employees?.email||"",documentNames:u.items.map(e=>e.title),auditEntries:e,documentHash:t}),n=window.open("","_blank");n&&(n.document.write(r),n.document.close())}catch(e){console.error("Audit trail error:",e),alert("감사추적인증서를 불러오는 중 오류가 발생했습니다.")}}async function D(){if(u){_(!0);try{let e=await (0,s.verifyDocumentIntegrity)(u.id);E({valid:e.valid,hash:e.storedHash})}catch(e){console.error("Integrity check error:",e),E({valid:!1,hash:e.message||"검증 실패"})}finally{_(!1)}}}if(w)return(0,t.jsx)("div",{className:"min-h-screen flex items-center justify-center px-4 bg-gray-50",children:(0,t.jsxs)("div",{className:"w-full max-w-md",children:[(0,t.jsxs)("div",{className:"text-center",children:[(0,t.jsx)("div",{className:"w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4",children:(0,t.jsx)("svg",{className:"w-8 h-8 text-green-600",fill:"none",stroke:"currentColor",strokeWidth:"2.5",viewBox:"0 0 24 24",children:(0,t.jsx)("polyline",{points:"20 6 9 17 4 12"})})}),(0,t.jsx)("h1",{className:"text-2xl font-extrabold text-gray-900 mb-2",children:"서명 완료"}),(0,t.jsx)("p",{className:"text-gray-600 text-sm",children:"모든 문서에 서명이 완료되었습니다"}),(0,t.jsx)("p",{className:"text-gray-400 text-xs mt-1",children:"서명 완료 문서와 감사추적인증서가 이메일로 발송됩니다"})]}),(0,t.jsxs)("div",{className:"mt-6 p-4 bg-white rounded-xl border border-gray-200",children:[(0,t.jsx)("p",{className:"text-sm text-gray-600",children:u.title}),(0,t.jsxs)("p",{className:"text-xs text-gray-400 mt-1",children:["서명자: ",u.employees?.name," | 문서: ",u.items.length,"건"]})]}),(0,t.jsxs)("button",{onClick:M,className:"mt-4 w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition flex items-center justify-center gap-2",children:[(0,t.jsx)("svg",{className:"w-4 h-4",fill:"none",stroke:"currentColor",strokeWidth:"2",viewBox:"0 0 24 24",children:(0,t.jsx)("path",{d:"M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"})}),"감사추적인증서 보기"]}),(0,t.jsxs)("div",{className:"mt-4 p-4 bg-white rounded-xl border border-gray-200",children:[(0,t.jsxs)("div",{className:"flex items-center justify-between",children:[(0,t.jsx)("p",{className:"text-sm font-semibold text-gray-700",children:"문서 무결성 검증"}),(0,t.jsx)("button",{onClick:D,disabled:S,className:"px-3 py-1.5 text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition disabled:opacity-50",children:S?"검증 중...":"검증하기"})]}),k&&(0,t.jsx)("div",{className:"mt-3",children:k.valid?(0,t.jsxs)("div",{className:"flex items-start gap-2 p-3 bg-green-50 rounded-lg border border-green-200",children:[(0,t.jsx)("span",{className:"text-green-600 mt-0.5",children:"✓"}),(0,t.jsxs)("div",{children:[(0,t.jsx)("p",{className:"text-sm font-medium text-green-700",children:"문서가 서명 후 변경되지 않았습니다"}),(0,t.jsxs)("p",{className:"text-xs text-green-600/70 mt-1 font-mono break-all",children:["SHA-256: ",k.hash]})]})]}):(0,t.jsxs)("div",{className:"flex items-start gap-2 p-3 bg-red-50 rounded-lg border border-red-200",children:[(0,t.jsx)("span",{className:"text-red-600 mt-0.5",children:"✗"}),(0,t.jsxs)("div",{children:[(0,t.jsx)("p",{className:"text-sm font-medium text-red-700",children:"문서가 변경된 것으로 감지됩니다"}),(0,t.jsx)("p",{className:"text-xs text-red-600/70 mt-1 font-mono break-all",children:k.hash})]})]})})]})]})});let $=u.items[h],P=u.items.filter(e=>"signed"===e.status).length,z=$?.documents?.content_json;return(0,t.jsxs)("div",{className:"min-h-screen bg-gray-50",children:[(0,t.jsx)("header",{className:"bg-white border-b border-gray-200 sticky top-0 z-10",children:(0,t.jsxs)("div",{className:"max-w-3xl mx-auto px-4 py-3 flex items-center justify-between",children:[(0,t.jsxs)("div",{children:[(0,t.jsx)("h1",{className:"text-lg font-bold text-gray-900",children:u.title}),(0,t.jsxs)("p",{className:"text-xs text-gray-500",children:[u.employees?.name," (",u.employees?.department||"",")"]})]}),(0,t.jsx)("div",{className:"text-right",children:(0,t.jsxs)("span",{className:"inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700",children:[P,"/",u.items.length," 완료"]})})]})}),(0,t.jsx)("div",{className:"bg-white border-b border-gray-200",children:(0,t.jsx)("div",{className:"max-w-3xl mx-auto px-4 flex gap-1 overflow-x-auto py-2",children:u.items.map((e,r)=>(0,t.jsxs)("button",{onClick:()=>{p(r),m(null);try{(0,o.logAuditTrail)(u.id,{action:"document_viewed",timestamp:new Date().toISOString(),actor:u.employees?.name||"unknown",details:`문서 확인: ${e.title}`})}catch(e){console.error("Audit log error:",e)}},className:`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition ${r===h?"bg-blue-600 text-white":"signed"===e.status?"bg-green-50 text-green-700":"bg-gray-100 text-gray-600 hover:bg-gray-200"}`,children:["signed"===e.status&&"✓ ",e.title]},e.id))})}),(0,t.jsx)("div",{className:"max-w-3xl mx-auto px-4 py-6",children:$?.status==="signed"?(0,t.jsxs)("div",{className:"bg-white rounded-2xl border border-green-200 p-6 text-center",children:[(0,t.jsx)("div",{className:"w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3",children:(0,t.jsx)("svg",{className:"w-6 h-6 text-green-600",fill:"none",stroke:"currentColor",strokeWidth:"2.5",viewBox:"0 0 24 24",children:(0,t.jsx)("polyline",{points:"20 6 9 17 4 12"})})}),(0,t.jsx)("p",{className:"text-green-700 font-semibold",children:"이 문서는 서명 완료되었습니다"}),(0,t.jsxs)("p",{className:"text-xs text-gray-400 mt-1",children:["서명 시각: ",$.signed_at?new Date($.signed_at).toLocaleString("ko-KR"):"-"]})]}):(0,t.jsxs)(t.Fragment,{children:[(0,t.jsxs)("div",{className:"bg-white rounded-2xl border border-gray-200 p-6 md:p-8 mb-6 shadow-sm",children:[z?.title&&(0,t.jsx)("h2",{className:"text-xl font-bold text-center text-gray-900 mb-6 pb-4 border-b border-gray-100",children:z.title}),z?.sections?.map((e,r)=>(0,t.jsxs)("div",{className:"mb-5",children:[e.heading&&(0,t.jsx)("h3",{className:"text-sm font-bold text-gray-800 mb-2",children:e.heading}),(0,t.jsx)("p",{className:"text-sm text-gray-600 leading-relaxed whitespace-pre-wrap",children:e.body})]},r))]}),(0,t.jsxs)("div",{className:"bg-white rounded-2xl border border-gray-200 p-6 shadow-sm",children:[(0,t.jsx)("h3",{className:"text-sm font-bold text-gray-800 mb-4",children:"서명"}),!g&&(0,t.jsxs)("div",{className:"space-y-3",children:[N&&(0,t.jsxs)("button",{onClick:()=>m("saved"),className:"w-full py-4 rounded-xl border-2 border-blue-200 bg-blue-50 hover:border-blue-400 transition text-center",children:[(0,t.jsxs)("div",{className:"flex items-center justify-center gap-2 mb-2",children:[(0,t.jsx)("svg",{className:"w-5 h-5 text-blue-600",fill:"none",stroke:"currentColor",strokeWidth:"2",viewBox:"0 0 24 24",children:(0,t.jsx)("polyline",{points:"20 6 9 17 4 12"})}),(0,t.jsx)("span",{className:"text-sm font-semibold text-blue-700",children:"저장된 서명 사용"})]}),"draw"===N.type?(0,t.jsx)("img",{src:N.data,alt:"저장된 서명",className:"h-12 mx-auto opacity-60"}):(0,t.jsx)("span",{className:"text-xl italic text-blue-800",style:{fontFamily:"cursive, serif"},children:N.data})]}),(0,t.jsxs)("div",{className:"flex gap-3",children:[(0,t.jsxs)("button",{onClick:()=>m("draw"),className:"flex-1 py-4 rounded-xl border-2 border-dashed border-gray-300 hover:border-blue-400 hover:bg-blue-50 transition text-center",children:[(0,t.jsx)("svg",{className:"w-6 h-6 mx-auto mb-1 text-gray-400",fill:"none",stroke:"currentColor",strokeWidth:"1.5",viewBox:"0 0 24 24",children:(0,t.jsx)("path",{d:"M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z"})}),(0,t.jsx)("span",{className:"text-xs font-medium text-gray-600",children:"직접 그리기"})]}),(0,t.jsxs)("button",{onClick:()=>m("type"),className:"flex-1 py-4 rounded-xl border-2 border-dashed border-gray-300 hover:border-blue-400 hover:bg-blue-50 transition text-center",children:[(0,t.jsx)("svg",{className:"w-6 h-6 mx-auto mb-1 text-gray-400",fill:"none",stroke:"currentColor",strokeWidth:"1.5",viewBox:"0 0 24 24",children:(0,t.jsx)("path",{d:"M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"})}),(0,t.jsx)("span",{className:"text-xs font-medium text-gray-600",children:"텍스트 입력"})]})]})]}),"saved"===g&&N&&(0,t.jsxs)("div",{children:[(0,t.jsxs)("div",{className:"p-6 bg-gray-50 rounded-xl border-2 border-blue-200 text-center mb-4",children:[(0,t.jsx)("p",{className:"text-xs text-gray-500 mb-2",children:"저장된 서명"}),"draw"===N.type?(0,t.jsx)("img",{src:N.data,alt:"서명",className:"h-16 mx-auto"}):(0,t.jsx)("p",{className:"text-3xl italic text-gray-800",style:{fontFamily:"cursive, serif"},children:N.data})]}),(0,t.jsxs)("div",{className:"flex gap-2",children:[(0,t.jsx)("button",{onClick:()=>m(null),className:"px-4 py-2.5 text-sm rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50",children:"다른 방식"}),(0,t.jsx)("button",{onClick:R,disabled:b,className:"flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition disabled:opacity-50",children:b?"처리 중...":"서명 완료"})]})]}),"draw"===g&&(0,t.jsxs)("div",{children:[(0,t.jsxs)("div",{className:"relative border-2 border-gray-200 rounded-xl overflow-hidden mb-3",children:[(0,t.jsx)("canvas",{ref:B,width:600,height:200,className:"w-full h-[150px] cursor-crosshair touch-none bg-gray-50",onMouseDown:O,onMouseMove:I,onMouseUp:U,onMouseLeave:U,onTouchStart:O,onTouchMove:I,onTouchEnd:U}),(0,t.jsx)("button",{onClick:L,className:"absolute top-2 right-2 px-2 py-1 text-xs bg-white/80 hover:bg-white rounded border border-gray-200 text-gray-500",children:"지우기"})]}),(0,t.jsx)("p",{className:"text-xs text-gray-400 mb-4",children:"위 영역에 서명을 그려주세요"}),(0,t.jsxs)("div",{className:"flex gap-2",children:[(0,t.jsx)("button",{onClick:()=>{m(null),L()},className:"px-4 py-2.5 text-sm rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50",children:"취소"}),(0,t.jsx)("button",{onClick:R,disabled:b,className:"flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition disabled:opacity-50",children:b?"처리 중...":"서명 완료"})]})]}),"type"===g&&(0,t.jsxs)("div",{children:[(0,t.jsx)("input",{type:"text",value:x,onChange:e=>y(e.target.value),placeholder:"서명할 이름을 입력하세요",className:"w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-lg text-center mb-3 focus:outline-none focus:border-blue-500",style:{fontFamily:"cursive, serif",fontSize:"24px"}}),(0,t.jsx)("p",{className:"text-xs text-gray-400 mb-4",children:"서명으로 사용할 이름을 입력하세요"}),(0,t.jsxs)("div",{className:"flex gap-2",children:[(0,t.jsx)("button",{onClick:()=>{m(null),y("")},className:"px-4 py-2.5 text-sm rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50",children:"취소"}),(0,t.jsx)("button",{onClick:R,disabled:b||!x.trim(),className:"flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition disabled:opacity-50",children:b?"처리 중...":"서명 완료"})]})]})]})]})}),(0,t.jsx)("footer",{className:"border-t border-gray-200 bg-white mt-8",children:(0,t.jsx)("div",{className:"max-w-3xl mx-auto px-4 py-4 text-center",children:(0,t.jsx)("p",{className:"text-xs text-gray-400",children:"OwnerView 전자서명 시스템"})})})]})}e.s(["default",()=>l])}]);