(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,67034,(t,e,r)=>{var i={675:function(t,e){"use strict";e.byteLength=function(t){var e=l(t),r=e[0],i=e[1];return(r+i)*3/4-i},e.toByteArray=function(t){var e,r,a=l(t),o=a[0],s=a[1],c=new n((o+s)*3/4-s),d=0,u=s>0?o-4:o;for(r=0;r<u;r+=4)e=i[t.charCodeAt(r)]<<18|i[t.charCodeAt(r+1)]<<12|i[t.charCodeAt(r+2)]<<6|i[t.charCodeAt(r+3)],c[d++]=e>>16&255,c[d++]=e>>8&255,c[d++]=255&e;return 2===s&&(e=i[t.charCodeAt(r)]<<2|i[t.charCodeAt(r+1)]>>4,c[d++]=255&e),1===s&&(e=i[t.charCodeAt(r)]<<10|i[t.charCodeAt(r+1)]<<4|i[t.charCodeAt(r+2)]>>2,c[d++]=e>>8&255,c[d++]=255&e),c},e.fromByteArray=function(t){for(var e,i=t.length,n=i%3,a=[],o=0,s=i-n;o<s;o+=16383)a.push(function(t,e,i){for(var n,a=[],o=e;o<i;o+=3)n=(t[o]<<16&0xff0000)+(t[o+1]<<8&65280)+(255&t[o+2]),a.push(r[n>>18&63]+r[n>>12&63]+r[n>>6&63]+r[63&n]);return a.join("")}(t,o,o+16383>s?s:o+16383));return 1===n?a.push(r[(e=t[i-1])>>2]+r[e<<4&63]+"=="):2===n&&a.push(r[(e=(t[i-2]<<8)+t[i-1])>>10]+r[e>>4&63]+r[e<<2&63]+"="),a.join("")};for(var r=[],i=[],n="u">typeof Uint8Array?Uint8Array:Array,a="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",o=0,s=a.length;o<s;++o)r[o]=a[o],i[a.charCodeAt(o)]=o;function l(t){var e=t.length;if(e%4>0)throw Error("Invalid string. Length must be a multiple of 4");var r=t.indexOf("=");-1===r&&(r=e);var i=r===e?0:4-r%4;return[r,i]}i[45]=62,i[95]=63},72:function(t,e,r){"use strict";var i=r(675),n=r(783),a="function"==typeof Symbol&&"function"==typeof Symbol.for?Symbol.for("nodejs.util.inspect.custom"):null;function o(t){if(t>0x7fffffff)throw RangeError('The value "'+t+'" is invalid for option "size"');var e=new Uint8Array(t);return Object.setPrototypeOf(e,s.prototype),e}function s(t,e,r){if("number"==typeof t){if("string"==typeof e)throw TypeError('The "string" argument must be of type string. Received type number');return d(t)}return l(t,e,r)}function l(t,e,r){if("string"==typeof t){var i=t,n=e;if(("string"!=typeof n||""===n)&&(n="utf8"),!s.isEncoding(n))throw TypeError("Unknown encoding: "+n);var a=0|p(i,n),l=o(a),c=l.write(i,n);return c!==a&&(l=l.slice(0,c)),l}if(ArrayBuffer.isView(t))return u(t);if(null==t)throw TypeError("The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type "+typeof t);if(C(t,ArrayBuffer)||t&&C(t.buffer,ArrayBuffer)||"u">typeof SharedArrayBuffer&&(C(t,SharedArrayBuffer)||t&&C(t.buffer,SharedArrayBuffer)))return function(t,e,r){var i;if(e<0||t.byteLength<e)throw RangeError('"offset" is outside of buffer bounds');if(t.byteLength<e+(r||0))throw RangeError('"length" is outside of buffer bounds');return Object.setPrototypeOf(i=void 0===e&&void 0===r?new Uint8Array(t):void 0===r?new Uint8Array(t,e):new Uint8Array(t,e,r),s.prototype),i}(t,e,r);if("number"==typeof t)throw TypeError('The "value" argument must not be of type number. Received type number');var d=t.valueOf&&t.valueOf();if(null!=d&&d!==t)return s.from(d,e,r);var h=function(t){if(s.isBuffer(t)){var e=0|f(t.length),r=o(e);return 0===r.length||t.copy(r,0,0,e),r}return void 0!==t.length?"number"!=typeof t.length||function(t){return t!=t}(t.length)?o(0):u(t):"Buffer"===t.type&&Array.isArray(t.data)?u(t.data):void 0}(t);if(h)return h;if("u">typeof Symbol&&null!=Symbol.toPrimitive&&"function"==typeof t[Symbol.toPrimitive])return s.from(t[Symbol.toPrimitive]("string"),e,r);throw TypeError("The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type "+typeof t)}function c(t){if("number"!=typeof t)throw TypeError('"size" argument must be of type number');if(t<0)throw RangeError('The value "'+t+'" is invalid for option "size"')}function d(t){return c(t),o(t<0?0:0|f(t))}function u(t){for(var e=t.length<0?0:0|f(t.length),r=o(e),i=0;i<e;i+=1)r[i]=255&t[i];return r}e.Buffer=s,e.SlowBuffer=function(t){return+t!=t&&(t=0),s.alloc(+t)},e.INSPECT_MAX_BYTES=50,e.kMaxLength=0x7fffffff,s.TYPED_ARRAY_SUPPORT=function(){try{var t=new Uint8Array(1),e={foo:function(){return 42}};return Object.setPrototypeOf(e,Uint8Array.prototype),Object.setPrototypeOf(t,e),42===t.foo()}catch(t){return!1}}(),!s.TYPED_ARRAY_SUPPORT&&"u">typeof console&&"function"==typeof console.error&&console.error("This browser lacks typed array (Uint8Array) support which is required by `buffer` v5.x. Use `buffer` v4.x if you require old browser support."),Object.defineProperty(s.prototype,"parent",{enumerable:!0,get:function(){if(s.isBuffer(this))return this.buffer}}),Object.defineProperty(s.prototype,"offset",{enumerable:!0,get:function(){if(s.isBuffer(this))return this.byteOffset}}),s.poolSize=8192,s.from=function(t,e,r){return l(t,e,r)},Object.setPrototypeOf(s.prototype,Uint8Array.prototype),Object.setPrototypeOf(s,Uint8Array),s.alloc=function(t,e,r){return(c(t),t<=0)?o(t):void 0!==e?"string"==typeof r?o(t).fill(e,r):o(t).fill(e):o(t)},s.allocUnsafe=function(t){return d(t)},s.allocUnsafeSlow=function(t){return d(t)};function f(t){if(t>=0x7fffffff)throw RangeError("Attempt to allocate Buffer larger than maximum size: 0x7fffffff bytes");return 0|t}function p(t,e){if(s.isBuffer(t))return t.length;if(ArrayBuffer.isView(t)||C(t,ArrayBuffer))return t.byteLength;if("string"!=typeof t)throw TypeError('The "string" argument must be one of type string, Buffer, or ArrayBuffer. Received type '+typeof t);var r=t.length,i=arguments.length>2&&!0===arguments[2];if(!i&&0===r)return 0;for(var n=!1;;)switch(e){case"ascii":case"latin1":case"binary":return r;case"utf8":case"utf-8":return S(t).length;case"ucs2":case"ucs-2":case"utf16le":case"utf-16le":return 2*r;case"hex":return r>>>1;case"base64":return A(t).length;default:if(n)return i?-1:S(t).length;e=(""+e).toLowerCase(),n=!0}}function h(t,e,r){var n,a,o,s=!1;if((void 0===e||e<0)&&(e=0),e>this.length||((void 0===r||r>this.length)&&(r=this.length),r<=0||(r>>>=0)<=(e>>>=0)))return"";for(t||(t="utf8");;)switch(t){case"hex":return function(t,e,r){var i=t.length;(!e||e<0)&&(e=0),(!r||r<0||r>i)&&(r=i);for(var n="",a=e;a<r;++a)n+=E[t[a]];return n}(this,e,r);case"utf8":case"utf-8":return b(this,e,r);case"ascii":return function(t,e,r){var i="";r=Math.min(t.length,r);for(var n=e;n<r;++n)i+=String.fromCharCode(127&t[n]);return i}(this,e,r);case"latin1":case"binary":return function(t,e,r){var i="";r=Math.min(t.length,r);for(var n=e;n<r;++n)i+=String.fromCharCode(t[n]);return i}(this,e,r);case"base64":return n=this,a=e,o=r,0===a&&o===n.length?i.fromByteArray(n):i.fromByteArray(n.slice(a,o));case"ucs2":case"ucs-2":case"utf16le":case"utf-16le":return function(t,e,r){for(var i=t.slice(e,r),n="",a=0;a<i.length;a+=2)n+=String.fromCharCode(i[a]+256*i[a+1]);return n}(this,e,r);default:if(s)throw TypeError("Unknown encoding: "+t);t=(t+"").toLowerCase(),s=!0}}function m(t,e,r){var i=t[e];t[e]=t[r],t[r]=i}function g(t,e,r,i,n){var a;if(0===t.length)return -1;if("string"==typeof r?(i=r,r=0):r>0x7fffffff?r=0x7fffffff:r<-0x80000000&&(r=-0x80000000),(a=r*=1)!=a&&(r=n?0:t.length-1),r<0&&(r=t.length+r),r>=t.length)if(n)return -1;else r=t.length-1;else if(r<0)if(!n)return -1;else r=0;if("string"==typeof e&&(e=s.from(e,i)),s.isBuffer(e))return 0===e.length?-1:y(t,e,r,i,n);if("number"==typeof e){if(e&=255,"function"==typeof Uint8Array.prototype.indexOf)if(n)return Uint8Array.prototype.indexOf.call(t,e,r);else return Uint8Array.prototype.lastIndexOf.call(t,e,r);return y(t,[e],r,i,n)}throw TypeError("val must be string, number or Buffer")}function y(t,e,r,i,n){var a,o=1,s=t.length,l=e.length;if(void 0!==i&&("ucs2"===(i=String(i).toLowerCase())||"ucs-2"===i||"utf16le"===i||"utf-16le"===i)){if(t.length<2||e.length<2)return -1;o=2,s/=2,l/=2,r/=2}function c(t,e){return 1===o?t[e]:t.readUInt16BE(e*o)}if(n){var d=-1;for(a=r;a<s;a++)if(c(t,a)===c(e,-1===d?0:a-d)){if(-1===d&&(d=a),a-d+1===l)return d*o}else -1!==d&&(a-=a-d),d=-1}else for(r+l>s&&(r=s-l),a=r;a>=0;a--){for(var u=!0,f=0;f<l;f++)if(c(t,a+f)!==c(e,f)){u=!1;break}if(u)return a}return -1}s.isBuffer=function(t){return null!=t&&!0===t._isBuffer&&t!==s.prototype},s.compare=function(t,e){if(C(t,Uint8Array)&&(t=s.from(t,t.offset,t.byteLength)),C(e,Uint8Array)&&(e=s.from(e,e.offset,e.byteLength)),!s.isBuffer(t)||!s.isBuffer(e))throw TypeError('The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array');if(t===e)return 0;for(var r=t.length,i=e.length,n=0,a=Math.min(r,i);n<a;++n)if(t[n]!==e[n]){r=t[n],i=e[n];break}return r<i?-1:+(i<r)},s.isEncoding=function(t){switch(String(t).toLowerCase()){case"hex":case"utf8":case"utf-8":case"ascii":case"latin1":case"binary":case"base64":case"ucs2":case"ucs-2":case"utf16le":case"utf-16le":return!0;default:return!1}},s.concat=function(t,e){if(!Array.isArray(t))throw TypeError('"list" argument must be an Array of Buffers');if(0===t.length)return s.alloc(0);if(void 0===e)for(r=0,e=0;r<t.length;++r)e+=t[r].length;var r,i=s.allocUnsafe(e),n=0;for(r=0;r<t.length;++r){var a=t[r];if(C(a,Uint8Array)&&(a=s.from(a)),!s.isBuffer(a))throw TypeError('"list" argument must be an Array of Buffers');a.copy(i,n),n+=a.length}return i},s.byteLength=p,s.prototype._isBuffer=!0,s.prototype.swap16=function(){var t=this.length;if(t%2!=0)throw RangeError("Buffer size must be a multiple of 16-bits");for(var e=0;e<t;e+=2)m(this,e,e+1);return this},s.prototype.swap32=function(){var t=this.length;if(t%4!=0)throw RangeError("Buffer size must be a multiple of 32-bits");for(var e=0;e<t;e+=4)m(this,e,e+3),m(this,e+1,e+2);return this},s.prototype.swap64=function(){var t=this.length;if(t%8!=0)throw RangeError("Buffer size must be a multiple of 64-bits");for(var e=0;e<t;e+=8)m(this,e,e+7),m(this,e+1,e+6),m(this,e+2,e+5),m(this,e+3,e+4);return this},s.prototype.toString=function(){var t=this.length;return 0===t?"":0==arguments.length?b(this,0,t):h.apply(this,arguments)},s.prototype.toLocaleString=s.prototype.toString,s.prototype.equals=function(t){if(!s.isBuffer(t))throw TypeError("Argument must be a Buffer");return this===t||0===s.compare(this,t)},s.prototype.inspect=function(){var t="",r=e.INSPECT_MAX_BYTES;return t=this.toString("hex",0,r).replace(/(.{2})/g,"$1 ").trim(),this.length>r&&(t+=" ... "),"<Buffer "+t+">"},a&&(s.prototype[a]=s.prototype.inspect),s.prototype.compare=function(t,e,r,i,n){if(C(t,Uint8Array)&&(t=s.from(t,t.offset,t.byteLength)),!s.isBuffer(t))throw TypeError('The "target" argument must be one of type Buffer or Uint8Array. Received type '+typeof t);if(void 0===e&&(e=0),void 0===r&&(r=t?t.length:0),void 0===i&&(i=0),void 0===n&&(n=this.length),e<0||r>t.length||i<0||n>this.length)throw RangeError("out of range index");if(i>=n&&e>=r)return 0;if(i>=n)return -1;if(e>=r)return 1;if(e>>>=0,r>>>=0,i>>>=0,n>>>=0,this===t)return 0;for(var a=n-i,o=r-e,l=Math.min(a,o),c=this.slice(i,n),d=t.slice(e,r),u=0;u<l;++u)if(c[u]!==d[u]){a=c[u],o=d[u];break}return a<o?-1:+(o<a)},s.prototype.includes=function(t,e,r){return -1!==this.indexOf(t,e,r)},s.prototype.indexOf=function(t,e,r){return g(this,t,e,r,!0)},s.prototype.lastIndexOf=function(t,e,r){return g(this,t,e,r,!1)};function b(t,e,r){r=Math.min(t.length,r);for(var i=[],n=e;n<r;){var a,o,s,l,c=t[n],d=null,u=c>239?4:c>223?3:c>191?2:1;if(n+u<=r)switch(u){case 1:c<128&&(d=c);break;case 2:(192&(a=t[n+1]))==128&&(l=(31&c)<<6|63&a)>127&&(d=l);break;case 3:a=t[n+1],o=t[n+2],(192&a)==128&&(192&o)==128&&(l=(15&c)<<12|(63&a)<<6|63&o)>2047&&(l<55296||l>57343)&&(d=l);break;case 4:a=t[n+1],o=t[n+2],s=t[n+3],(192&a)==128&&(192&o)==128&&(192&s)==128&&(l=(15&c)<<18|(63&a)<<12|(63&o)<<6|63&s)>65535&&l<1114112&&(d=l)}null===d?(d=65533,u=1):d>65535&&(d-=65536,i.push(d>>>10&1023|55296),d=56320|1023&d),i.push(d),n+=u}var f=i,p=f.length;if(p<=4096)return String.fromCharCode.apply(String,f);for(var h="",m=0;m<p;)h+=String.fromCharCode.apply(String,f.slice(m,m+=4096));return h}function x(t,e,r){if(t%1!=0||t<0)throw RangeError("offset is not uint");if(t+e>r)throw RangeError("Trying to access beyond buffer length")}function v(t,e,r,i,n,a){if(!s.isBuffer(t))throw TypeError('"buffer" argument must be a Buffer instance');if(e>n||e<a)throw RangeError('"value" argument is out of bounds');if(r+i>t.length)throw RangeError("Index out of range")}function w(t,e,r,i,n,a){if(r+i>t.length||r<0)throw RangeError("Index out of range")}function j(t,e,r,i,a){return e*=1,r>>>=0,a||w(t,e,r,4,34028234663852886e22,-34028234663852886e22),n.write(t,e,r,i,23,4),r+4}function N(t,e,r,i,a){return e*=1,r>>>=0,a||w(t,e,r,8,17976931348623157e292,-17976931348623157e292),n.write(t,e,r,i,52,8),r+8}s.prototype.write=function(t,e,r,i){if(void 0===e)i="utf8",r=this.length,e=0;else if(void 0===r&&"string"==typeof e)i=e,r=this.length,e=0;else if(isFinite(e))e>>>=0,isFinite(r)?(r>>>=0,void 0===i&&(i="utf8")):(i=r,r=void 0);else throw Error("Buffer.write(string, encoding, offset[, length]) is no longer supported");var n,a,o,s,l,c,d,u,f=this.length-e;if((void 0===r||r>f)&&(r=f),t.length>0&&(r<0||e<0)||e>this.length)throw RangeError("Attempt to write outside buffer bounds");i||(i="utf8");for(var p=!1;;)switch(i){case"hex":return function(t,e,r,i){r=Number(r)||0;var n=t.length-r;i?(i=Number(i))>n&&(i=n):i=n;var a=e.length;i>a/2&&(i=a/2);for(var o=0;o<i;++o){var s,l=parseInt(e.substr(2*o,2),16);if((s=l)!=s)break;t[r+o]=l}return o}(this,t,e,r);case"utf8":case"utf-8":return n=e,a=r,$(S(t,this.length-n),this,n,a);case"ascii":return o=e,s=r,$(k(t),this,o,s);case"latin1":case"binary":return function(t,e,r,i){return $(k(e),t,r,i)}(this,t,e,r);case"base64":return l=e,c=r,$(A(t),this,l,c);case"ucs2":case"ucs-2":case"utf16le":case"utf-16le":return d=e,u=r,$(function(t,e){for(var r,i,n=[],a=0;a<t.length&&!((e-=2)<0);++a)i=(r=t.charCodeAt(a))>>8,n.push(r%256),n.push(i);return n}(t,this.length-d),this,d,u);default:if(p)throw TypeError("Unknown encoding: "+i);i=(""+i).toLowerCase(),p=!0}},s.prototype.toJSON=function(){return{type:"Buffer",data:Array.prototype.slice.call(this._arr||this,0)}},s.prototype.slice=function(t,e){var r=this.length;t=~~t,e=void 0===e?r:~~e,t<0?(t+=r)<0&&(t=0):t>r&&(t=r),e<0?(e+=r)<0&&(e=0):e>r&&(e=r),e<t&&(e=t);var i=this.subarray(t,e);return Object.setPrototypeOf(i,s.prototype),i},s.prototype.readUIntLE=function(t,e,r){t>>>=0,e>>>=0,r||x(t,e,this.length);for(var i=this[t],n=1,a=0;++a<e&&(n*=256);)i+=this[t+a]*n;return i},s.prototype.readUIntBE=function(t,e,r){t>>>=0,e>>>=0,r||x(t,e,this.length);for(var i=this[t+--e],n=1;e>0&&(n*=256);)i+=this[t+--e]*n;return i},s.prototype.readUInt8=function(t,e){return t>>>=0,e||x(t,1,this.length),this[t]},s.prototype.readUInt16LE=function(t,e){return t>>>=0,e||x(t,2,this.length),this[t]|this[t+1]<<8},s.prototype.readUInt16BE=function(t,e){return t>>>=0,e||x(t,2,this.length),this[t]<<8|this[t+1]},s.prototype.readUInt32LE=function(t,e){return t>>>=0,e||x(t,4,this.length),(this[t]|this[t+1]<<8|this[t+2]<<16)+0x1000000*this[t+3]},s.prototype.readUInt32BE=function(t,e){return t>>>=0,e||x(t,4,this.length),0x1000000*this[t]+(this[t+1]<<16|this[t+2]<<8|this[t+3])},s.prototype.readIntLE=function(t,e,r){t>>>=0,e>>>=0,r||x(t,e,this.length);for(var i=this[t],n=1,a=0;++a<e&&(n*=256);)i+=this[t+a]*n;return i>=(n*=128)&&(i-=Math.pow(2,8*e)),i},s.prototype.readIntBE=function(t,e,r){t>>>=0,e>>>=0,r||x(t,e,this.length);for(var i=e,n=1,a=this[t+--i];i>0&&(n*=256);)a+=this[t+--i]*n;return a>=(n*=128)&&(a-=Math.pow(2,8*e)),a},s.prototype.readInt8=function(t,e){return(t>>>=0,e||x(t,1,this.length),128&this[t])?-((255-this[t]+1)*1):this[t]},s.prototype.readInt16LE=function(t,e){t>>>=0,e||x(t,2,this.length);var r=this[t]|this[t+1]<<8;return 32768&r?0xffff0000|r:r},s.prototype.readInt16BE=function(t,e){t>>>=0,e||x(t,2,this.length);var r=this[t+1]|this[t]<<8;return 32768&r?0xffff0000|r:r},s.prototype.readInt32LE=function(t,e){return t>>>=0,e||x(t,4,this.length),this[t]|this[t+1]<<8|this[t+2]<<16|this[t+3]<<24},s.prototype.readInt32BE=function(t,e){return t>>>=0,e||x(t,4,this.length),this[t]<<24|this[t+1]<<16|this[t+2]<<8|this[t+3]},s.prototype.readFloatLE=function(t,e){return t>>>=0,e||x(t,4,this.length),n.read(this,t,!0,23,4)},s.prototype.readFloatBE=function(t,e){return t>>>=0,e||x(t,4,this.length),n.read(this,t,!1,23,4)},s.prototype.readDoubleLE=function(t,e){return t>>>=0,e||x(t,8,this.length),n.read(this,t,!0,52,8)},s.prototype.readDoubleBE=function(t,e){return t>>>=0,e||x(t,8,this.length),n.read(this,t,!1,52,8)},s.prototype.writeUIntLE=function(t,e,r,i){if(t*=1,e>>>=0,r>>>=0,!i){var n=Math.pow(2,8*r)-1;v(this,t,e,r,n,0)}var a=1,o=0;for(this[e]=255&t;++o<r&&(a*=256);)this[e+o]=t/a&255;return e+r},s.prototype.writeUIntBE=function(t,e,r,i){if(t*=1,e>>>=0,r>>>=0,!i){var n=Math.pow(2,8*r)-1;v(this,t,e,r,n,0)}var a=r-1,o=1;for(this[e+a]=255&t;--a>=0&&(o*=256);)this[e+a]=t/o&255;return e+r},s.prototype.writeUInt8=function(t,e,r){return t*=1,e>>>=0,r||v(this,t,e,1,255,0),this[e]=255&t,e+1},s.prototype.writeUInt16LE=function(t,e,r){return t*=1,e>>>=0,r||v(this,t,e,2,65535,0),this[e]=255&t,this[e+1]=t>>>8,e+2},s.prototype.writeUInt16BE=function(t,e,r){return t*=1,e>>>=0,r||v(this,t,e,2,65535,0),this[e]=t>>>8,this[e+1]=255&t,e+2},s.prototype.writeUInt32LE=function(t,e,r){return t*=1,e>>>=0,r||v(this,t,e,4,0xffffffff,0),this[e+3]=t>>>24,this[e+2]=t>>>16,this[e+1]=t>>>8,this[e]=255&t,e+4},s.prototype.writeUInt32BE=function(t,e,r){return t*=1,e>>>=0,r||v(this,t,e,4,0xffffffff,0),this[e]=t>>>24,this[e+1]=t>>>16,this[e+2]=t>>>8,this[e+3]=255&t,e+4},s.prototype.writeIntLE=function(t,e,r,i){if(t*=1,e>>>=0,!i){var n=Math.pow(2,8*r-1);v(this,t,e,r,n-1,-n)}var a=0,o=1,s=0;for(this[e]=255&t;++a<r&&(o*=256);)t<0&&0===s&&0!==this[e+a-1]&&(s=1),this[e+a]=(t/o|0)-s&255;return e+r},s.prototype.writeIntBE=function(t,e,r,i){if(t*=1,e>>>=0,!i){var n=Math.pow(2,8*r-1);v(this,t,e,r,n-1,-n)}var a=r-1,o=1,s=0;for(this[e+a]=255&t;--a>=0&&(o*=256);)t<0&&0===s&&0!==this[e+a+1]&&(s=1),this[e+a]=(t/o|0)-s&255;return e+r},s.prototype.writeInt8=function(t,e,r){return t*=1,e>>>=0,r||v(this,t,e,1,127,-128),t<0&&(t=255+t+1),this[e]=255&t,e+1},s.prototype.writeInt16LE=function(t,e,r){return t*=1,e>>>=0,r||v(this,t,e,2,32767,-32768),this[e]=255&t,this[e+1]=t>>>8,e+2},s.prototype.writeInt16BE=function(t,e,r){return t*=1,e>>>=0,r||v(this,t,e,2,32767,-32768),this[e]=t>>>8,this[e+1]=255&t,e+2},s.prototype.writeInt32LE=function(t,e,r){return t*=1,e>>>=0,r||v(this,t,e,4,0x7fffffff,-0x80000000),this[e]=255&t,this[e+1]=t>>>8,this[e+2]=t>>>16,this[e+3]=t>>>24,e+4},s.prototype.writeInt32BE=function(t,e,r){return t*=1,e>>>=0,r||v(this,t,e,4,0x7fffffff,-0x80000000),t<0&&(t=0xffffffff+t+1),this[e]=t>>>24,this[e+1]=t>>>16,this[e+2]=t>>>8,this[e+3]=255&t,e+4},s.prototype.writeFloatLE=function(t,e,r){return j(this,t,e,!0,r)},s.prototype.writeFloatBE=function(t,e,r){return j(this,t,e,!1,r)},s.prototype.writeDoubleLE=function(t,e,r){return N(this,t,e,!0,r)},s.prototype.writeDoubleBE=function(t,e,r){return N(this,t,e,!1,r)},s.prototype.copy=function(t,e,r,i){if(!s.isBuffer(t))throw TypeError("argument should be a Buffer");if(r||(r=0),i||0===i||(i=this.length),e>=t.length&&(e=t.length),e||(e=0),i>0&&i<r&&(i=r),i===r||0===t.length||0===this.length)return 0;if(e<0)throw RangeError("targetStart out of bounds");if(r<0||r>=this.length)throw RangeError("Index out of range");if(i<0)throw RangeError("sourceEnd out of bounds");i>this.length&&(i=this.length),t.length-e<i-r&&(i=t.length-e+r);var n=i-r;if(this===t&&"function"==typeof Uint8Array.prototype.copyWithin)this.copyWithin(e,r,i);else if(this===t&&r<e&&e<i)for(var a=n-1;a>=0;--a)t[a+e]=this[a+r];else Uint8Array.prototype.set.call(t,this.subarray(r,i),e);return n},s.prototype.fill=function(t,e,r,i){if("string"==typeof t){if("string"==typeof e?(i=e,e=0,r=this.length):"string"==typeof r&&(i=r,r=this.length),void 0!==i&&"string"!=typeof i)throw TypeError("encoding must be a string");if("string"==typeof i&&!s.isEncoding(i))throw TypeError("Unknown encoding: "+i);if(1===t.length){var n,a=t.charCodeAt(0);("utf8"===i&&a<128||"latin1"===i)&&(t=a)}}else"number"==typeof t?t&=255:"boolean"==typeof t&&(t=Number(t));if(e<0||this.length<e||this.length<r)throw RangeError("Out of range index");if(r<=e)return this;if(e>>>=0,r=void 0===r?this.length:r>>>0,t||(t=0),"number"==typeof t)for(n=e;n<r;++n)this[n]=t;else{var o=s.isBuffer(t)?t:s.from(t,i),l=o.length;if(0===l)throw TypeError('The value "'+t+'" is invalid for argument "value"');for(n=0;n<r-e;++n)this[n+e]=o[n%l]}return this};var _=/[^+/0-9A-Za-z-_]/g;function S(t,e){e=e||1/0;for(var r,i=t.length,n=null,a=[],o=0;o<i;++o){if((r=t.charCodeAt(o))>55295&&r<57344){if(!n){if(r>56319||o+1===i){(e-=3)>-1&&a.push(239,191,189);continue}n=r;continue}if(r<56320){(e-=3)>-1&&a.push(239,191,189),n=r;continue}r=(n-55296<<10|r-56320)+65536}else n&&(e-=3)>-1&&a.push(239,191,189);if(n=null,r<128){if((e-=1)<0)break;a.push(r)}else if(r<2048){if((e-=2)<0)break;a.push(r>>6|192,63&r|128)}else if(r<65536){if((e-=3)<0)break;a.push(r>>12|224,r>>6&63|128,63&r|128)}else if(r<1114112){if((e-=4)<0)break;a.push(r>>18|240,r>>12&63|128,r>>6&63|128,63&r|128)}else throw Error("Invalid code point")}return a}function k(t){for(var e=[],r=0;r<t.length;++r)e.push(255&t.charCodeAt(r));return e}function A(t){return i.toByteArray(function(t){if((t=(t=t.split("=")[0]).trim().replace(_,"")).length<2)return"";for(;t.length%4!=0;)t+="=";return t}(t))}function $(t,e,r,i){for(var n=0;n<i&&!(n+r>=e.length)&&!(n>=t.length);++n)e[n+r]=t[n];return n}function C(t,e){return t instanceof e||null!=t&&null!=t.constructor&&null!=t.constructor.name&&t.constructor.name===e.name}var E=function(){for(var t="0123456789abcdef",e=Array(256),r=0;r<16;++r)for(var i=16*r,n=0;n<16;++n)e[i+n]=t[r]+t[n];return e}()},783:function(t,e){e.read=function(t,e,r,i,n){var a,o,s=8*n-i-1,l=(1<<s)-1,c=l>>1,d=-7,u=r?n-1:0,f=r?-1:1,p=t[e+u];for(u+=f,a=p&(1<<-d)-1,p>>=-d,d+=s;d>0;a=256*a+t[e+u],u+=f,d-=8);for(o=a&(1<<-d)-1,a>>=-d,d+=i;d>0;o=256*o+t[e+u],u+=f,d-=8);if(0===a)a=1-c;else{if(a===l)return o?NaN:1/0*(p?-1:1);o+=Math.pow(2,i),a-=c}return(p?-1:1)*o*Math.pow(2,a-i)},e.write=function(t,e,r,i,n,a){var o,s,l,c=8*a-n-1,d=(1<<c)-1,u=d>>1,f=5960464477539062e-23*(23===n),p=i?0:a-1,h=i?1:-1,m=+(e<0||0===e&&1/e<0);for(isNaN(e=Math.abs(e))||e===1/0?(s=+!!isNaN(e),o=d):(o=Math.floor(Math.log(e)/Math.LN2),e*(l=Math.pow(2,-o))<1&&(o--,l*=2),o+u>=1?e+=f/l:e+=f*Math.pow(2,1-u),e*l>=2&&(o++,l/=2),o+u>=d?(s=0,o=d):o+u>=1?(s=(e*l-1)*Math.pow(2,n),o+=u):(s=e*Math.pow(2,u-1)*Math.pow(2,n),o=0));n>=8;t[r+p]=255&s,p+=h,s/=256,n-=8);for(o=o<<n|s,c+=n;c>0;t[r+p]=255&o,p+=h,o/=256,c-=8);t[r+p-h]|=128*m}}},n={};function a(t){var e=n[t];if(void 0!==e)return e.exports;var r=n[t]={exports:{}},o=!0;try{i[t](r,r.exports,a),o=!1}finally{o&&delete n[t]}return r.exports}a.ab="/ROOT/node_modules/next/dist/compiled/buffer/",e.exports=a(72)},62164,t=>{"use strict";var e=t.i(43476),r=t.i(71645);let i=(0,r.createContext)({toast:()=>{}});function n(){return(0,r.useContext)(i)}let a=0;function o({children:t}){let[n,o]=(0,r.useState)([]),s=(0,r.useCallback)((t,e="info")=>{let r=++a;o(i=>[...i,{id:r,message:t,type:e}]),setTimeout(()=>{o(t=>t.filter(t=>t.id!==r))},4e3)},[]);return(0,e.jsxs)(i.Provider,{value:{toast:s},children:[t,(0,e.jsx)("div",{className:"fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm",children:n.map(t=>(0,e.jsx)("div",{className:`px-4 py-3 rounded-lg shadow-lg text-sm text-white animate-in slide-in-from-right fade-in duration-300 ${"success"===t.type?"bg-green-600":"error"===t.type?"bg-red-600":"bg-zinc-800"}`,onClick:()=>o(e=>e.filter(e=>e.id!==t.id)),children:t.message},t.id))})]})}t.s(["ToastProvider",()=>o,"useToast",()=>n])},18566,(t,e,r)=>{e.exports=t.r(76562)},40352,t=>{"use strict";var e=t.i(7471);async function r(t){let{error:r}=await e.supabase.from("audit_logs").insert({company_id:t.companyId,user_id:t.userId??null,entity_type:t.entityType,entity_id:t.entityId,action:t.action,before_json:t.beforeJson??null,after_json:t.afterJson??null,metadata:t.metadata??null});if(r)throw r}t.s(["logAudit",()=>r])},10160,t=>{"use strict";function e(t){return(e="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t})(t)}t.s(["default",()=>e])},94286,t=>{"use strict";let e=null;async function r(t){if(!e)try{let t=await fetch("https://fonts.gstatic.com/s/nanumgothic/v23/PN_3Rfi-oW3hYwmKDpxS7F_z_tLfxno73g.ttf");if(!t.ok)throw Error(`Font fetch failed: ${t.status}`);let r=await t.arrayBuffer(),i=new Uint8Array(r),n="";for(let t=0;t<i.length;t+=8192){let e=i.subarray(t,Math.min(t+8192,i.length));n+=String.fromCharCode.apply(null,e)}e=btoa(n)}catch(t){console.warn("Korean font load failed, falling back to helvetica:",t);return}t.addFileToVFS("NanumGothic-Regular.ttf",e),t.addFont("NanumGothic-Regular.ttf","NanumGothic","normal"),t.addFont("NanumGothic-Regular.ttf","NanumGothic","bold")}function i(t,e="normal"){try{t.setFont("NanumGothic",e)}catch{t.setFont("helvetica",e)}}t.s(["loadKoreanFont",()=>r,"setKoreanFont",()=>i])},87200,t=>{"use strict";var e=t.i(55749),r=t.i(45700),i=t.i(7471),n=t.i(40352),a=t.i(94286);let o=i.supabase;async function s(t,e="DOC"){let r=new Date,i=`${r.getFullYear()}${String(r.getMonth()+1).padStart(2,"0")}`,n=`${e}-${i}-%`,{data:a}=await o.from("documents").select("document_number").eq("company_id",t).like("document_number",n).order("document_number",{ascending:!1}).limit(1),l=1;if(a&&a.length>0&&a[0].document_number){let t=a[0].document_number.split("-"),e=parseInt(t[t.length-1],10);isNaN(e)||(l=e+1)}return`${e}-${i}-${String(l).padStart(4,"0")}`}async function l(t){let i=new e.default("p","mm","a4");await (0,a.loadKoreanFont)(i);let n=i.internal.pageSize.getWidth(),o=i.internal.pageSize.getHeight(),s=20;i.setFontSize(12),(0,a.setKoreanFont)(i,"normal"),i.setTextColor(100,100,100),i.text(t.companyName,14,s),t.documentNumber&&(i.setFontSize(9),i.text(t.documentNumber,n-14,s,{align:"right"})),s+=12,i.setFontSize(18),(0,a.setKoreanFont)(i,"bold"),i.setTextColor(30,30,30),i.text(t.title,n/2,s,{align:"center"}),s+=14,i.setDrawColor(200,200,200),i.line(14,s,n-14,s),s+=10;let l=t.content.split("\n").map(t=>[t]);(0,r.default)(i,{startY:s,body:l,theme:"plain",styles:{fontSize:10,cellPadding:{top:1.5,bottom:1.5,left:2,right:2},textColor:[40,40,40],lineWidth:0,font:"NanumGothic"},columnStyles:{0:{cellWidth:n-28}},margin:{left:14,right:14},tableLineColor:[255,255,255],tableLineWidth:0}),s=i.lastAutoTable.finalY+15;let c=t.issueDate||new Date().toLocaleDateString("ko-KR");s>o-80&&(i.addPage(),s=20),i.setFontSize(10),(0,a.setKoreanFont)(i,"normal"),i.setTextColor(60,60,60),i.text(c,n/2,s,{align:"center"}),s+=10;let d=t.companyInfo;if(d){let e=[];for(let r of(e.push(t.companyName),d.address&&e.push(d.address),d.businessNumber&&e.push(`사업자등록번호: ${d.businessNumber}`),d.phone&&e.push(`TEL: ${d.phone}`),d.representative&&e.push(`대표이사: ${d.representative}`),i.setFontSize(9),e))i.text(r,n/2,s,{align:"center"}),s+=5}if(t.applyStamp&&t.sealUrl)try{let e=await p(t.sealUrl),r=s-10;i.addImage(e,"PNG",n-14-30,r,30,30)}catch{console.warn("Seal image load failed, skipping stamp overlay")}return m(i,t.companyName),i.output("blob")}async function c(t){let i=new e.default("p","mm","a4");await (0,a.loadKoreanFont)(i);let n=i.internal.pageSize.getWidth(),o=15;i.setFontSize(20),(0,a.setKoreanFont)(i,"bold"),i.setTextColor(30,30,30),i.text("견 적 서",n/2,o,{align:"center"}),o+=12,i.setFontSize(9),(0,a.setKoreanFont)(i,"normal"),i.setTextColor(80,80,80),i.text(`No. ${t.documentNumber}`,14,o),i.text(`Date: ${new Date().toLocaleDateString("ko-KR")}`,n-14,o,{align:"right"}),o+=8;let s=[["수 신",`${t.counterparty} 귀하`],["발 신",t.companyInfo.name],["대표이사",t.companyInfo.representative||"-"],["사업자번호",t.companyInfo.businessNumber||"-"],["주 소",t.companyInfo.address||"-"],["연락처",t.companyInfo.phone||"-"]];t.managerName&&s.push(["담 당 자",t.managerName+(t.managerContact?` (${t.managerContact})`:"")]),(0,r.default)(i,{startY:o,body:s,theme:"grid",styles:{fontSize:9,cellPadding:3,font:"NanumGothic"},columnStyles:{0:{cellWidth:30,fontStyle:"bold",fillColor:[245,247,250]},1:{cellWidth:n-58}},margin:{left:14,right:14}}),o=i.lastAutoTable.finalY+6,i.setFillColor(59,130,246),i.roundedRect(14,o,n-28,12,2,2,"F"),i.setFontSize(12),(0,a.setKoreanFont)(i,"bold"),i.setTextColor(255,255,255),i.text(`합계금액:  ${h(t.totalAmount)} 원 (VAT 포함)`,n/2,o+8,{align:"center"}),o+=18;let l=t.items.map((t,e)=>[String(e+1),t.name,t.spec||"-",t.qty.toLocaleString("ko-KR"),h(t.unitPrice),h(t.amount)]);(0,r.default)(i,{startY:o,head:[["No","품 명","규 격","수 량","단 가","금 액"]],body:l,theme:"grid",styles:{fontSize:8,cellPadding:3,halign:"center",font:"NanumGothic"},headStyles:{fillColor:[59,130,246],textColor:255,fontStyle:"bold",font:"NanumGothic"},columnStyles:{0:{cellWidth:12},1:{cellWidth:50,halign:"left"},2:{cellWidth:30},3:{cellWidth:20},4:{cellWidth:30,halign:"right"},5:{cellWidth:35,halign:"right"}},margin:{left:14,right:14},alternateRowStyles:{fillColor:[248,249,250]}}),o=i.lastAutoTable.finalY+2,(0,r.default)(i,{startY:o,body:[["공급가액",`${h(t.supplyAmount)} 원`],["부가세 (10%)",`${h(t.taxAmount)} 원`],["합계금액",`${h(t.totalAmount)} 원`]],theme:"grid",styles:{fontSize:9,cellPadding:3,font:"NanumGothic"},columnStyles:{0:{cellWidth:40,fontStyle:"bold",fillColor:[245,247,250],halign:"center"},1:{halign:"right"}},margin:{left:n-14-100,right:14}}),o=i.lastAutoTable.finalY+6;let c=[];if(t.validUntil&&c.push(["유효기간",t.validUntil]),t.deliveryDate&&c.push(["납품일",t.deliveryDate]),t.bankInfo){let e=t.bankInfo.accountHolder?` (${t.bankInfo.accountHolder})`:"";c.push(["입금계좌",`${t.bankInfo.bankName} ${t.bankInfo.accountNumber}${e}`])}if(t.notes&&c.push(["비 고",t.notes]),c.length>0&&((0,r.default)(i,{startY:o,body:c,theme:"grid",styles:{fontSize:9,cellPadding:3,font:"NanumGothic"},columnStyles:{0:{cellWidth:30,fontStyle:"bold",fillColor:[245,247,250]}},margin:{left:14,right:14}}),o=i.lastAutoTable.finalY+6),t.sealUrl)try{let e=await p(t.sealUrl);i.addImage(e,"PNG",n-14-30-5,o,30,30)}catch{console.warn("Seal image load failed, skipping stamp overlay")}return m(i,t.companyInfo.name),i.output("blob")}async function d(t,e,r){let i=await s(r),a=new Date().toISOString(),{error:l}=await o.from("documents").update({document_number:i,status:"issued",issued_at:a,locked_at:a}).eq("id",t);if(l)throw l;await (0,n.logAudit)({companyId:r,userId:e,entityType:"document",entityId:t,action:"issue",afterJson:{document_number:i,status:"issued",issued_at:a,locked_at:a}})}function u(t){let{documentNumber:e,date:r,partyA:i,partyB:n,contractAmount:a,taxAmount:o,totalAmount:s,items:l,contractSubject:c,contractStartDate:d,contractEndDate:u,paymentTerms:p,deliveryDeadline:h,inspectionPeriod:m,warrantyPeriod:g,latePenaltyRate:y,specialTerms:b,sealUrlA:x,sealUrlB:v}=t,w=l.length>0?l.map((t,e)=>`
        <tr>
          <td style="text-align:center;">${e+1}</td>
          <td>${f(t.name)}</td>
          <td style="text-align:center;">${f(t.spec||"-")}</td>
          <td style="text-align:right;">${t.qty.toLocaleString("ko-KR")}</td>
          <td style="text-align:right;">${t.unitPrice.toLocaleString("ko-KR")}</td>
          <td style="text-align:right;">${t.amount.toLocaleString("ko-KR")}</td>
        </tr>`).join("\n"):`<tr><td colspan="6" style="text-align:center;color:#999;">품목 없음</td></tr>`,j=x?`<img src="${f(x)}" alt="갑 직인" style="width:60px;height:60px;margin-left:8px;vertical-align:middle;" />`:'<span style="display:inline-block;width:60px;height:60px;border:1px solid #ccc;border-radius:50%;text-align:center;line-height:60px;color:#ccc;font-size:11px;margin-left:8px;vertical-align:middle;">인</span>',N=v?`<img src="${f(v)}" alt="을 직인" style="width:60px;height:60px;margin-left:8px;vertical-align:middle;" />`:'<span style="display:inline-block;width:60px;height:60px;border:1px solid #ccc;border-radius:50%;text-align:center;line-height:60px;color:#ccc;font-size:11px;margin-left:8px;vertical-align:middle;">인</span>',_=b?f(b).replace(/\n/g,"<br/>"):"해당 없음";return`<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>계약서 - ${f(e)}</title>
<style>
  @page {
    size: A4;
    margin: 20mm 15mm 20mm 15mm;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Pretendard', 'Noto Sans KR', 'Malgun Gothic', sans-serif;
    font-size: 10pt;
    line-height: 1.7;
    color: #222;
    background: #fff;
  }
  .contract-page {
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto;
    padding: 20mm 15mm;
    background: #fff;
  }
  @media print {
    body { background: #fff; }
    .contract-page { padding: 0; margin: 0; width: 100%; }
  }
  .contract-title {
    text-align: center;
    font-size: 20pt;
    font-weight: 700;
    letter-spacing: 12px;
    margin-bottom: 24px;
    padding-bottom: 12px;
    border-bottom: 2px solid #333;
  }
  .doc-meta {
    display: flex;
    justify-content: space-between;
    font-size: 9pt;
    color: #666;
    margin-bottom: 20px;
  }
  .party-section {
    margin-bottom: 20px;
    padding: 12px 16px;
    border: 1px solid #ddd;
    border-radius: 4px;
    background: #fafafa;
  }
  .party-section .party-label {
    font-weight: 700;
    font-size: 11pt;
    color: #1a56db;
    margin-bottom: 4px;
  }
  .party-section .party-detail {
    font-size: 9.5pt;
    color: #444;
    line-height: 1.8;
  }
  .amount-box {
    text-align: center;
    background: #1a56db;
    color: #fff;
    padding: 10px 16px;
    border-radius: 6px;
    font-size: 13pt;
    font-weight: 700;
    margin: 16px 0;
    letter-spacing: 1px;
  }
  .items-table {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0 20px;
    font-size: 9pt;
  }
  .items-table th {
    background: #1a56db;
    color: #fff;
    padding: 6px 8px;
    font-weight: 600;
    text-align: center;
    border: 1px solid #1a56db;
  }
  .items-table td {
    padding: 5px 8px;
    border: 1px solid #ddd;
  }
  .items-table tr:nth-child(even) td {
    background: #f8f9fa;
  }
  .amount-summary {
    text-align: right;
    margin: 8px 0 20px;
    font-size: 9.5pt;
  }
  .amount-summary .row {
    margin-bottom: 2px;
  }
  .amount-summary .total {
    font-weight: 700;
    font-size: 10.5pt;
    border-top: 1px solid #333;
    padding-top: 4px;
    margin-top: 4px;
  }
  .article {
    margin-bottom: 12px;
    page-break-inside: avoid;
  }
  .article-title {
    font-weight: 700;
    font-size: 10.5pt;
    margin-bottom: 4px;
    color: #1a1a1a;
  }
  .article-body {
    padding-left: 8px;
    font-size: 9.5pt;
    color: #333;
  }
  .article-body p {
    margin-bottom: 3px;
  }
  .signature-block {
    margin-top: 40px;
    page-break-inside: avoid;
  }
  .signature-date {
    text-align: center;
    font-size: 11pt;
    font-weight: 600;
    margin-bottom: 32px;
  }
  .signature-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 24px;
  }
  .signature-party {
    width: 45%;
  }
  .signature-party .sig-label {
    font-weight: 700;
    font-size: 11pt;
    margin-bottom: 8px;
  }
  .signature-party .sig-detail {
    font-size: 9pt;
    color: #555;
    line-height: 1.8;
    margin-bottom: 12px;
  }
  .signature-party .sig-line {
    display: flex;
    align-items: center;
    margin-top: 8px;
  }
  .signature-party .sig-line .label {
    font-weight: 600;
    white-space: nowrap;
  }
  .signature-party .sig-line .stamp-area {
    display: inline-block;
    margin-left: 8px;
  }
  .closing-text {
    text-align: center;
    font-size: 9.5pt;
    color: #555;
    margin-top: 24px;
    line-height: 1.8;
  }
  .footer {
    text-align: center;
    font-size: 7pt;
    color: #aaa;
    margin-top: 32px;
    padding-top: 8px;
    border-top: 1px solid #eee;
  }
</style>
</head>
<body>
<div class="contract-page">

  <!-- Header -->
  <div class="contract-title">계 약 서</div>
  <div class="doc-meta">
    <span>계약번호: ${f(e)}</span>
    <span>계약일자: ${f(r)}</span>
  </div>

  <!-- Party Info -->
  <div class="party-section">
    <div class="party-label">"갑" (위탁자)</div>
    <div class="party-detail">
      상호: ${f(i.name)}<br/>
      대표이사: ${f(i.representative||"")}<br/>
      사업자등록번호: ${f(i.businessNumber||"")}<br/>
      주소: ${f(i.address||"")}<br/>
      ${i.phone?`연락처: ${f(i.phone)}<br/>`:""}
    </div>
  </div>
  <div class="party-section">
    <div class="party-label">"을" (수탁자)</div>
    <div class="party-detail">
      상호: ${f(n.name)}<br/>
      대표이사: ${f(n.representative||"")}<br/>
      사업자등록번호: ${f(n.businessNumber||"")}<br/>
      주소: ${f(n.address||"")}<br/>
      ${n.phone?`연락처: ${f(n.phone)}<br/>`:""}
    </div>
  </div>

  <!-- Contract Amount -->
  <div class="amount-box">
    합계금액: ₩${s.toLocaleString("ko-KR")} 원 (VAT 포함)
  </div>

  <!-- Items Table -->
  <table class="items-table">
    <thead>
      <tr>
        <th style="width:8%;">No</th>
        <th style="width:32%;">품명</th>
        <th style="width:16%;">규격</th>
        <th style="width:10%;">수량</th>
        <th style="width:16%;">단가</th>
        <th style="width:18%;">금액</th>
      </tr>
    </thead>
    <tbody>
      ${w}
    </tbody>
  </table>
  <div class="amount-summary">
    <div class="row">공급가액: ₩${a.toLocaleString("ko-KR")}</div>
    <div class="row">부가가치세(10%): ₩${o.toLocaleString("ko-KR")}</div>
    <div class="total">합계: ₩${s.toLocaleString("ko-KR")}</div>
  </div>

  <!-- Contract Articles (16조) -->
  <div class="article">
    <div class="article-title">제1조 (계약목적)</div>
    <div class="article-body">
      <p>본 계약은 "${f(c)}"(이하 "본 건"이라 한다)에 관하여 갑과 을 사이의 권리\xb7의무 관계를 명확히 규정함을 목적으로 한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제2조 (계약기간)</div>
    <div class="article-body">
      <p>① 본 계약의 유효기간은 ${f(d)}부터 ${f(u||"프로젝트 완료 시")}까지로 한다.</p>
      <p>② 계약기간 만료 1개월 전까지 쌍방 이의가 없는 경우 동일 조건으로 1년간 자동 연장되며, 이후에도 같다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제3조 (계약금액)</div>
    <div class="article-body">
      <p>① 본 계약의 대금은 금 ${a.toLocaleString("ko-KR")} 원정(부가가치세 별도)으로 한다.</p>
      <p>② 부가가치세는 관련 법령에 따라 별도 청구하며, 세금계산서 발행을 원칙으로 한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제4조 (납품 및 인도)</div>
    <div class="article-body">
      <p>① 을은 ${f(h||"별도 협의")}까지 본 건의 결과물(이하 "납품물"이라 한다)을 갑에게 납품\xb7인도한다.</p>
      <p>② 납품 장소는 갑이 지정한 장소로 하며, 납품에 소요되는 비용은 을이 부담한다.</p>
      <p>③ 을은 납품 시 납품명세서를 첨부하여야 한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제5조 (검수)</div>
    <div class="article-body">
      <p>① 갑은 납품일로부터 ${f(m)} 이내에 납품물의 수량\xb7품질\xb7규격 등을 검수하여야 한다.</p>
      <p>② 검수 결과 하자가 발견된 경우 갑은 을에게 보완, 교체 또는 재납품을 요구할 수 있으며, 을은 지체 없이 이에 응하여야 한다.</p>
      <p>③ 검수 기간 내 갑이 별도의 이의를 제기하지 아니한 경우 검수에 합격한 것으로 본다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제6조 (대금지급)</div>
    <div class="article-body">
      <p>① ${f(p||"별도 협의")}</p>
      <p>② 갑은 을이 적법한 세금계산서를 발행한 날로부터 30일 이내에 대금을 지급한다.</p>
      <p>③ 갑의 귀책사유로 지급이 지연되는 경우 연 이율 5%의 지연이자를 가산하여 지급한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제7조 (하자보수)</div>
    <div class="article-body">
      <p>① 을은 납품물에 대하여 검수 완료일로부터 ${f(g)} 동안 하자보수 책임을 진다.</p>
      <p>② 하자보수 기간 중 을의 귀책사유로 발생한 하자에 대하여 을은 무상으로 보수 또는 교체하여야 한다.</p>
      <p>③ 을이 하자보수 요청을 받은 날로부터 7영업일 이내에 보수를 개시하지 않는 경우 갑은 제3자에게 보수를 의뢰하고 그 비용을 을에게 청구할 수 있다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제8조 (지체상금)</div>
    <div class="article-body">
      <p>① 을이 납품기한을 초과하여 이행하는 경우 지체일수 1일당 계약금액의 ${f(y)}%에 해당하는 금액을 지체상금으로 갑에게 납부하여야 한다.</p>
      <p>② 지체상금의 총액은 계약금액의 10%를 초과하지 아니한다.</p>
      <p>③ 불가항력 사유에 해당하는 경우에는 지체상금을 면제한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제9조 (손해배상)</div>
    <div class="article-body">
      <p>① 갑 또는 을이 본 계약상의 의무를 위반하여 상대방에게 손해를 끼친 경우 이를 배상하여야 한다.</p>
      <p>② 손해배상의 범위는 통상 손해에 한하되, 특별한 사정으로 인한 손해는 채무자가 그 사정을 알았거나 알 수 있었을 때에 한하여 배상한다.</p>
      <p>③ 본 조의 손해배상 청구권은 손해 발생 사실을 안 날로부터 1년, 손해 발생일로부터 3년 이내에 행사하여야 한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제10조 (권리\xb7의무의 양도 금지)</div>
    <div class="article-body">
      <p>갑과 을은 상대방의 사전 서면 동의 없이 본 계약상의 권리\xb7의무의 전부 또는 일부를 제3자에게 양도하거나 담보로 제공할 수 없다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제11조 (불가항력)</div>
    <div class="article-body">
      <p>① 천재지변, 전쟁, 내란, 법령의 개폐, 정부의 행위, 전염병, 파업 기타 당사자의 통제 범위를 벗어나는 사유(이하 "불가항력"이라 한다)로 인하여 본 계약을 이행할 수 없는 경우 그 책임을 면한다.</p>
      <p>② 불가항력 사유가 발생한 당사자는 즉시 상대방에게 서면으로 통지하고, 그 사유가 종료된 후 지체 없이 계약 이행을 재개하여야 한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제12조 (비밀유지)</div>
    <div class="article-body">
      <p>① 갑과 을은 본 계약의 체결 및 이행과정에서 취득한 상대방의 기밀정보(기술정보, 영업정보, 고객정보 등)를 제3자에게 누설하거나 본 계약 목적 외의 용도로 사용하지 아니한다.</p>
      <p>② 비밀유지 의무는 본 계약 종료 후에도 3년간 존속한다.</p>
      <p>③ 법령에 의한 공개 의무가 있는 경우 또는 상대방의 서면 동의를 얻은 경우에는 예외로 한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제13조 (계약해지)</div>
    <div class="article-body">
      <p>① 갑 또는 을이 다음 각 호에 해당하는 경우 상대방은 서면 통지로써 본 계약을 해지할 수 있다.</p>
      <p style="padding-left:12px;">1. 본 계약상의 중대한 의무를 위반하고 서면 최고 후 14일 이내에 시정하지 않는 경우</p>
      <p style="padding-left:12px;">2. 파산, 회생 절차 개시, 해산 결의 등으로 정상적인 계약 이행이 곤란한 경우</p>
      <p style="padding-left:12px;">3. 어음\xb7수표의 부도 등으로 지급불능 상태에 빠진 경우</p>
      <p>② 계약 해지 시 기 수행된 부분에 대하여는 상호 정산하여 처리한다.</p>
      <p>③ 계약 해지는 이미 발생한 손해배상 청구권에 영향을 미치지 아니한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제14조 (분쟁해결)</div>
    <div class="article-body">
      <p>① 본 계약에 관한 분쟁은 갑과 을이 성실히 협의하여 해결한다.</p>
      <p>② 협의가 이루어지지 아니하는 경우 갑의 본점 소재지를 관할하는 법원을 제1심 관할법원으로 한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제15조 (기타)</div>
    <div class="article-body">
      <p>① 본 계약에 정하지 아니한 사항은 상관례 및 민법, 상법 등 관련 법령에 따른다.</p>
      <p>② 본 계약의 변경은 갑과 을의 서면 합의에 의하여야 하며, 구두 합의는 효력이 없다.</p>
      <p>③ 본 계약의 어느 조항이 무효 또는 집행 불가능하더라도 나머지 조항의 유효성에는 영향을 미치지 아니한다.</p>
    </div>
  </div>

  <div class="article">
    <div class="article-title">제16조 (특약사항)</div>
    <div class="article-body">
      <p>${_}</p>
    </div>
  </div>

  <!-- Closing + Signature -->
  <div class="closing-text">
    본 계약의 성립을 증명하기 위하여 계약서 2통을 작성하고,<br/>
    갑\xb7을이 각각 서명 날인한 후 각 1통씩 보관한다.
  </div>

  <div class="signature-block">
    <div class="signature-date">${f(r)}</div>
    <div class="signature-row">
      <div class="signature-party">
        <div class="sig-label">"갑"</div>
        <div class="sig-detail">
          ${f(i.name)}<br/>
          ${i.address?f(i.address)+"<br/>":""}
          ${i.businessNumber?"사업자등록번호: "+f(i.businessNumber)+"<br/>":""}
        </div>
        <div class="sig-line">
          <span class="label">대표이사 ${f(i.representative||"_______________")}</span>
          <span class="stamp-area">${j}</span>
        </div>
      </div>
      <div class="signature-party">
        <div class="sig-label">"을"</div>
        <div class="sig-detail">
          ${f(n.name)}<br/>
          ${n.address?f(n.address)+"<br/>":""}
          ${n.businessNumber?"사업자등록번호: "+f(n.businessNumber)+"<br/>":""}
        </div>
        <div class="sig-line">
          <span class="label">대표이사 ${f(n.representative||"_______________")}</span>
          <span class="stamp-area">${N}</span>
        </div>
      </div>
    </div>
  </div>

  <div class="footer">
    OwnerView Document System | ${f(e)} | Generated: ${new Date().toISOString().split("T")[0]}
  </div>

</div>
</body>
</html>`}function f(t){return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}async function p(t){let e=await fetch(t),r=await e.blob();return new Promise((t,e)=>{let i=new FileReader;i.onloadend=()=>t(i.result),i.onerror=e,i.readAsDataURL(r)})}function h(t){let e=Math.abs(t);return`${t<0?"-":""}${e.toLocaleString("ko-KR")}`}function m(t,e){let r=t.getNumberOfPages(),i=t.internal.pageSize.getWidth(),n=t.internal.pageSize.getHeight();for(let o=1;o<=r;o++)t.setPage(o),t.setFontSize(7),(0,a.setKoreanFont)(t,"normal"),t.setTextColor(150,150,150),t.text(`OwnerView Document  |  ${e}  |  Page ${o}/${r}`,i/2,n-8,{align:"center"})}t.s(["generateContractPDF",()=>u,"generateDocumentPDF",()=>l,"generateQuotePDF",()=>c,"issueDocument",()=>d])},53051,53845,t=>{"use strict";var e=t.i(7471);let r=e.supabase,i={document_created:"문서 생성",signing_requested:"서명 요청",email_sent:"이메일 발송",document_opened:"문서 열람",document_viewed:"문서 확인",signature_drawn:"서명 입력 (직접 그리기)",signature_typed:"서명 입력 (텍스트)",signature_submitted:"서명 제출",document_completed:"서명 완료",document_locked:"문서 잠금"};async function n(t,e){let{data:i,error:n}=await r.from("hr_contract_packages").select("id, notes").eq("id",t).single();if(n)throw Error(`감사추적 기록 실패 — 패키지 조회 오류: ${n.message}`);if(!i)throw Error(`감사추적 기록 실패 — 패키지를 찾을 수 없습니다: ${t}`);let a={};if(i.notes)try{let t=JSON.parse(i.notes);a="object"!=typeof t||null===t||Array.isArray(t)?Array.isArray(t)?{audit_trail:t}:{text:String(t)}:t}catch{a={text:i.notes}}let o=Array.isArray(a.audit_trail)?a.audit_trail:[];o.push({action:e.action,timestamp:e.timestamp||new Date().toISOString(),actor:e.actor,...e.ip?{ip:e.ip}:{},...e.userAgent?{userAgent:e.userAgent}:{},...e.details?{details:e.details}:{}}),a.audit_trail=o;let{error:s}=await r.from("hr_contract_packages").update({notes:JSON.stringify(a)}).eq("id",t);if(s)throw Error(`감사추적 기록 실패 — DB 업데이트 오류: ${s.message}`)}async function a(t){let{data:e,error:i}=await r.from("hr_contract_packages").select("notes").eq("id",t).single();if(i)throw Error(`감사추적 조회 실패: ${i.message}`);if(!e?.notes)return[];try{let t=JSON.parse(e.notes);if(Array.isArray(t))return t;if("object"==typeof t&&null!==t&&Array.isArray(t.audit_trail))return t.audit_trail}catch{}return[]}function o(t){let{packageTitle:e,companyName:r,employeeName:n,signerEmail:a,documentNames:o,auditEntries:s,documentHash:l}=t,c=new Date().toLocaleString("ko-KR",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:!1}),d=t=>t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"),u=s.map((t,e)=>`
      <tr${e%2==1?' class="alt"':""}>
        <td class="seq">${e+1}</td>
        <td class="ts">${d((t=>{try{return new Date(t).toLocaleString("ko-KR",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:!1})}catch{return t}})(t.timestamp))}</td>
        <td class="action">${d(i[t.action]||t.action)}</td>
        <td class="actor">${d(t.actor)}</td>
        <td class="ip">${t.ip?d(t.ip):"-"}</td>
        <td class="details">${t.details?d(t.details):"-"}</td>
      </tr>`).join("\n"),f=o.map((t,e)=>`<li>${e+1}. ${d(t)}</li>`).join("\n");return`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>감사추적인증서 — ${d(e)}</title>
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
          <span class="info-value">${d(e)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">회사명</span>
          <span class="info-value">${d(r)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">서명자</span>
          <span class="info-value">${d(n)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">이메일</span>
          <span class="info-value">${d(a)}</span>
        </div>
        <div class="info-row" style="grid-column: span 2;">
          <span class="info-label">문서 수</span>
          <span class="info-value">${o.length}건</span>
        </div>
      </div>
    </div>

    <!-- Document List -->
    <div class="section">
      <div class="section-title">포함 문서</div>
      <ul class="doc-list">
        ${f}
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
        <div class="hash-value">${d(l)}</div>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <p class="legal-notice">
        본 인증서는 전자서명법 제3조에 따라 전자서명의 진정성을 증명합니다
      </p>
      <p class="generated-at">생성일시: ${d(c)}</p>
      <p class="system-name">OwnerView 전자서명 시스템</p>
    </div>
  </div>
</body>
</html>`}t.s(["generateAuditTrailCertificateHTML",()=>o,"getAuditTrail",()=>a,"logAuditTrail",()=>n],53051);let s=e.supabase;async function l(t){let e=new TextEncoder().encode(t);return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",e))).map(t=>t.toString(16).padStart(2,"0")).join("")}async function c(t){let{data:e,error:r}=await s.from("hr_contract_package_items").select("id, sort_order, signature_data, documents(content_json)").eq("package_id",t).order("sort_order");if(r)throw Error(`패키지 아이템 조회 실패: ${r.message}`);if(!e||0===e.length)throw Error("패키지에 문서가 없습니다");let i=[];for(let t of e)t.documents?.content_json&&i.push(JSON.stringify(t.documents.content_json)),t.signature_data&&i.push(JSON.stringify(t.signature_data));return l(i.join("|"))}async function d(t,e){let{data:r,error:i}=await s.from("hr_contract_packages").select("notes").eq("id",t).single();if(i)throw Error(`패키지 조회 실패: ${i.message}`);let n={};if(r?.notes)try{n=JSON.parse(r.notes)}catch{n={text:r.notes}}n.document_hash=e,n.hash_generated_at=new Date().toISOString();let{error:a}=await s.from("hr_contract_packages").update({notes:JSON.stringify(n)}).eq("id",t);if(a)throw Error(`해시 저장 실패: ${a.message}`)}async function u(t){let{data:e,error:r}=await s.from("hr_contract_packages").select("notes").eq("id",t).single();if(r)throw Error(`패키지 조회 실패: ${r.message}`);let i="";if(e?.notes)try{i=JSON.parse(e.notes).document_hash||""}catch{}if(!i)throw Error("저장된 해시가 없습니다. 먼저 storeDocumentHash를 호출하세요.");let n=await c(t);return{valid:i===n,storedHash:i,currentHash:n}}t.s(["generatePackageHash",()=>c,"storeDocumentHash",()=>d,"verifyDocumentIntegrity",()=>u],53845)},84099,t=>{"use strict";var e=t.i(43476),r=t.i(71645),i=t.i(18566),n=t.i(7471),a=t.i(62164),o=t.i(53051),s=t.i(53845),l=t.i(87200);let c=n.supabase;function d(){return(0,e.jsx)(a.ToastProvider,{children:(0,e.jsx)(r.Suspense,{fallback:(0,e.jsx)("div",{className:"min-h-screen flex items-center justify-center bg-gray-50",children:(0,e.jsx)("div",{className:"w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"})}),children:(0,e.jsx)(u,{})})})}function u(){let{toast:t}=(0,a.useToast)(),n=(0,i.useSearchParams)().get("token")||"",[d,u]=(0,r.useState)(!0),[f,p]=(0,r.useState)(!1),[h,m]=(0,r.useState)(null),[g,y]=(0,r.useState)(0),[b,x]=(0,r.useState)(null),[v,w]=(0,r.useState)(""),[j,N]=(0,r.useState)(!1),[_,S]=(0,r.useState)(!1),[k,A]=(0,r.useState)(null),[$,C]=(0,r.useState)(null),[E,T]=(0,r.useState)(!1),B=(0,r.useRef)(null),I=(0,r.useRef)(!1);async function z(){try{let{data:t}=await c.from("hr_contract_packages").select("*, employees(name, email, department, position), companies(name)").eq("sign_token",n).single();if(!t){let{data:t}=await c.from("signature_requests").select("*, documents(name, content_json, status, company_id)").eq("sign_token",n).single();if(t){let e=!!t.expires_at&&new Date(t.expires_at)<new Date,{data:r}=await c.from("companies").select("name").eq("id",t.documents?.company_id||t.company_id).single();m({id:t.id,title:t.title,status:t.status,expired:e,companies:r||{name:""},employees:{name:t.signer_name,email:t.signer_email,department:"",position:""},items:t.documents?[{id:t.id,documents:t.documents,sort_order:0}]:[],_isGeneralDoc:!0,_signatureRequestId:t.id}),"sent"===t.status&&await c.from("signature_requests").update({status:"viewed",viewed_at:new Date().toISOString()}).eq("id",t.id),u(!1);return}p(!0),u(!1);return}let e=!!t.expires_at&&new Date(t.expires_at)<new Date,{data:r}=await c.from("hr_contract_package_items").select("*, documents(name, content_json, status)").eq("package_id",t.id).order("sort_order");if(m({...t,expired:e,items:r||[]}),t.employee_id){let{data:e}=await c.from("employees").select("saved_signature").eq("id",t.employee_id).single();e?.saved_signature&&A(e.saved_signature)}"completed"===t.status&&S(!0);let i=(r||[]).findIndex(t=>"pending"===t.status);i>=0&&y(i),u(!1);try{(0,o.logAuditTrail)(t.id,{action:"document_opened",timestamp:new Date().toISOString(),actor:t.employees?.name||"unknown",userAgent:navigator.userAgent,details:`서명 페이지 접속`})}catch(t){console.error("Audit log error:",t)}}catch{p(!0),u(!1)}}(0,r.useEffect)(()=>{if(!n){p(!0),u(!1);return}z()},[n]);let O=(0,r.useCallback)(t=>{let e=B.current;if(!e)return;I.current=!0;let r=e.getContext("2d"),i=e.getBoundingClientRect(),n="touches"in t?t.touches[0].clientX-i.left:t.clientX-i.left,a="touches"in t?t.touches[0].clientY-i.top:t.clientY-i.top;r.beginPath(),r.moveTo(n,a)},[]),R=(0,r.useCallback)(t=>{if(!I.current)return;let e=B.current;if(!e)return;let r=e.getContext("2d"),i=e.getBoundingClientRect(),n="touches"in t?t.touches[0].clientX-i.left:t.clientX-i.left,a="touches"in t?t.touches[0].clientY-i.top:t.clientY-i.top;r.lineWidth=2,r.lineCap="round",r.strokeStyle="#1e293b",r.lineTo(n,a),r.stroke()},[]),U=(0,r.useCallback)(()=>{I.current=!1},[]),D=()=>{let t=B.current;t&&t.getContext("2d").clearRect(0,0,t.width,t.height)};async function L(){let e;if(!h)return;let r=h.items[g];if(r&&"signed"!==r.status){if("saved"===b&&k)e=k;else if("draw"===b){let t=B.current;if(!t)return;e={type:"draw",data:t.toDataURL("image/png")}}else{if("type"!==b||!v.trim())return;e={type:"type",data:v.trim()}}N(!0);try{await c.from("hr_contract_package_items").update({status:"signed",signed_at:new Date().toISOString(),signature_data:e}).eq("id",r.id);try{(0,o.logAuditTrail)(h.id,{action:"draw"===e.type?"signature_drawn":"signature_typed",timestamp:new Date().toISOString(),actor:h.employees?.name||"unknown",details:`서명 방식: ${"draw"===e.type?"직접 그리기":"텍스트 입력"}`})}catch(t){console.error("Audit log error:",t)}r.documents&&await c.from("documents").update({status:"locked",locked_at:new Date().toISOString()}).eq("id",r.document_id);let t=h.items.map((t,e)=>e===g?{...t,status:"signed",signed_at:new Date().toISOString()}:t),i=t.every(t=>"signed"===t.status),n=t.some(t=>"signed"===t.status);if(i){await c.from("hr_contract_packages").update({status:"completed",completed_at:new Date().toISOString()}).eq("id",h.id),S(!0);try{let t=await (0,s.generatePackageHash)(h.id);await (0,s.storeDocumentHash)(h.id,t)}catch(t){console.error("Hash generation error:",t)}try{await (0,o.logAuditTrail)(h.id,{action:"document_completed",timestamp:new Date().toISOString(),actor:h.employees?.name||"unknown",details:`전체 ${t.length}건 서명 완료`})}catch(t){console.error("Audit log error:",t)}try{let e="https://njbvdkuvtdtkxyylwngn.supabase.co",r=h.employees?.email||"",i=h.companies?.name||"";e&&r&&await fetch(`${e}/functions/v1/send-contract-email`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({to:r,employeeName:h.employees?.name||"",companyName:i,packageTitle:h.title,documentCount:t.length,signUrl:window.location.href,type:"completion",completedAt:new Date().toISOString()})})}catch(t){console.error("Completion email failed:",t)}}else n&&await c.from("hr_contract_packages").update({status:"partially_signed"}).eq("id",h.id);m({...h,items:t});let a=t.findIndex((t,e)=>e>g&&"pending"===t.status);a>=0&&(y(a),x(null),D(),w(""))}catch(e){t("서명 처리 중 오류: "+(e.message||"알 수 없는 오류"),"error")}finally{N(!1)}}}if(d)return(0,e.jsx)("div",{className:"min-h-screen flex items-center justify-center bg-gray-50",children:(0,e.jsxs)("div",{className:"text-center",children:[(0,e.jsx)("div",{className:"w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"}),(0,e.jsx)("p",{className:"text-sm text-gray-500",children:"계약서를 불러오는 중..."})]})});if(f||!h)return(0,e.jsx)("div",{className:"min-h-screen flex items-center justify-center px-4 bg-gray-50",children:(0,e.jsxs)("div",{className:"w-full max-w-md text-center",children:[(0,e.jsx)("div",{className:"w-14 h-14 rounded-2xl bg-red-50 text-red-600 text-xl font-black flex items-center justify-center mx-auto mb-4",children:"!"}),(0,e.jsx)("h1",{className:"text-2xl font-extrabold text-gray-900 mb-2",children:"유효하지 않은 링크"}),(0,e.jsx)("p",{className:"text-gray-500 text-sm",children:"서명 링크가 만료되었거나 유효하지 않습니다. 담당자에게 문의해주세요."})]})});if(h.expired)return(0,e.jsx)("div",{className:"min-h-screen flex items-center justify-center px-4 bg-gray-50",children:(0,e.jsxs)("div",{className:"w-full max-w-md text-center",children:[(0,e.jsx)("div",{className:"w-14 h-14 rounded-2xl bg-yellow-50 text-yellow-600 text-xl font-black flex items-center justify-center mx-auto mb-4",children:"!"}),(0,e.jsx)("h1",{className:"text-2xl font-extrabold text-gray-900 mb-2",children:"서명 기한 만료"}),(0,e.jsx)("p",{className:"text-gray-500 text-sm",children:"서명 기한이 만료되었습니다. 회사 담당자에게 재발송을 요청해주세요."})]})});async function P(){if(h)try{let t=await (0,o.getAuditTrail)(h.id),e="N/A";if(h.notes)try{e=JSON.parse(h.notes).document_hash||"N/A"}catch{}try{let{data:t}=await c.from("hr_contract_packages").select("notes").eq("id",h.id).single();if(t?.notes){let r=JSON.parse(t.notes);r.document_hash&&(e=r.document_hash)}}catch{}let r=(0,o.generateAuditTrailCertificateHTML)({packageTitle:h.title,companyName:h.companies?.name||"",employeeName:h.employees?.name||"",signerEmail:h.employees?.email||"",documentNames:h.items.map(t=>t.title),auditEntries:t,documentHash:e}),i=window.open("","_blank");i&&(i.document.write(r),i.document.close())}catch(e){console.error("Audit trail error:",e),t("감사추적인증서를 불러오는 중 오류가 발생했습니다.","error")}}async function F(){if(h)try{let t=[];for(let e of h.items){let r=e.documents;if(!r?.content_json)continue;let i=r.content_json;if(i.title&&t.push(i.title),i.sections)for(let e of i.sections)e.heading&&t.push(`
${e.heading}`),e.body&&t.push(e.body);t.push("")}let e=await (0,l.generateDocumentPDF)({title:h.title,content:t.join("\n"),companyName:h.companies?.name||""}),r=URL.createObjectURL(e),i=document.createElement("a");i.href=r,i.download=`${h.title||"서명완료문서"}.pdf`,document.body.appendChild(i),i.click(),document.body.removeChild(i),URL.revokeObjectURL(r)}catch(e){console.error("PDF generation error:",e),t("PDF 생성 중 오류가 발생했습니다.","error")}}async function M(){if(h){T(!0);try{let t=await (0,s.verifyDocumentIntegrity)(h.id);C({valid:t.valid,hash:t.storedHash})}catch(t){console.error("Integrity check error:",t),C({valid:!1,hash:t.message||"검증 실패"})}finally{T(!1)}}}if(_)return(0,e.jsx)("div",{className:"min-h-screen flex items-center justify-center px-4 bg-gray-50",children:(0,e.jsxs)("div",{className:"w-full max-w-md",children:[(0,e.jsxs)("div",{className:"text-center",children:[(0,e.jsx)("div",{className:"w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4",children:(0,e.jsx)("svg",{className:"w-8 h-8 text-green-600",fill:"none",stroke:"currentColor",strokeWidth:"2.5",viewBox:"0 0 24 24",children:(0,e.jsx)("polyline",{points:"20 6 9 17 4 12"})})}),(0,e.jsx)("h1",{className:"text-2xl font-extrabold text-gray-900 mb-2",children:"서명 완료"}),(0,e.jsx)("p",{className:"text-gray-600 text-sm",children:"모든 문서에 서명이 완료되었습니다"}),(0,e.jsx)("p",{className:"text-gray-400 text-xs mt-1",children:"서명 완료 문서와 감사추적인증서가 이메일로 발송됩니다"})]}),(0,e.jsxs)("div",{className:"mt-6 p-4 bg-white rounded-xl border border-gray-200",children:[(0,e.jsx)("p",{className:"text-sm text-gray-600",children:h.title}),(0,e.jsxs)("p",{className:"text-xs text-gray-400 mt-1",children:["서명자: ",h.employees?.name," | 문서: ",h.items.length,"건"]})]}),(0,e.jsxs)("button",{onClick:P,className:"mt-4 w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition flex items-center justify-center gap-2",children:[(0,e.jsx)("svg",{className:"w-4 h-4",fill:"none",stroke:"currentColor",strokeWidth:"2",viewBox:"0 0 24 24",children:(0,e.jsx)("path",{d:"M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"})}),"감사추적인증서 보기"]}),(0,e.jsxs)("button",{onClick:F,className:"mt-3 w-full py-3 bg-gray-800 hover:bg-gray-900 text-white rounded-xl text-sm font-semibold transition flex items-center justify-center gap-2",children:[(0,e.jsx)("svg",{className:"w-4 h-4",fill:"none",stroke:"currentColor",strokeWidth:"2",viewBox:"0 0 24 24",children:(0,e.jsx)("path",{d:"M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"})}),"서명된 계약서 PDF 다운로드"]}),(0,e.jsxs)("div",{className:"mt-4 p-4 bg-white rounded-xl border border-gray-200",children:[(0,e.jsxs)("div",{className:"flex items-center justify-between",children:[(0,e.jsx)("p",{className:"text-sm font-semibold text-gray-700",children:"문서 무결성 검증"}),(0,e.jsx)("button",{onClick:M,disabled:E,className:"px-3 py-1.5 text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition disabled:opacity-50",children:E?"검증 중...":"검증하기"})]}),$&&(0,e.jsx)("div",{className:"mt-3",children:$.valid?(0,e.jsxs)("div",{className:"flex items-start gap-2 p-3 bg-green-50 rounded-lg border border-green-200",children:[(0,e.jsx)("span",{className:"text-green-600 mt-0.5",children:"✓"}),(0,e.jsxs)("div",{children:[(0,e.jsx)("p",{className:"text-sm font-medium text-green-700",children:"문서가 서명 후 변경되지 않았습니다"}),(0,e.jsxs)("p",{className:"text-xs text-green-600/70 mt-1 font-mono break-all",children:["SHA-256: ",$.hash]})]})]}):(0,e.jsxs)("div",{className:"flex items-start gap-2 p-3 bg-red-50 rounded-lg border border-red-200",children:[(0,e.jsx)("span",{className:"text-red-600 mt-0.5",children:"✗"}),(0,e.jsxs)("div",{children:[(0,e.jsx)("p",{className:"text-sm font-medium text-red-700",children:"문서가 변경된 것으로 감지됩니다"}),(0,e.jsx)("p",{className:"text-xs text-red-600/70 mt-1 font-mono break-all",children:$.hash})]})]})})]})]})});let q=h.items[g],K=h.items.filter(t=>"signed"===t.status).length,W=q?.documents?.content_json;return(0,e.jsxs)("div",{className:"min-h-screen bg-gray-50",children:[(0,e.jsx)("header",{className:"bg-white border-b border-gray-200 sticky top-0 z-10",children:(0,e.jsxs)("div",{className:"max-w-3xl mx-auto px-4 py-3 flex items-center justify-between",children:[(0,e.jsxs)("div",{children:[(0,e.jsx)("h1",{className:"text-lg font-bold text-gray-900",children:h.title}),(0,e.jsxs)("p",{className:"text-xs text-gray-500",children:[h.employees?.name," (",h.employees?.department||"",")"]})]}),(0,e.jsx)("div",{className:"text-right",children:(0,e.jsxs)("span",{className:"inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700",children:[K,"/",h.items.length," 완료"]})})]})}),(0,e.jsx)("div",{className:"bg-white border-b border-gray-200",children:(0,e.jsx)("div",{className:"max-w-3xl mx-auto px-4 flex gap-1 overflow-x-auto py-2",children:h.items.map((t,r)=>(0,e.jsxs)("button",{onClick:()=>{y(r),x(null);try{(0,o.logAuditTrail)(h.id,{action:"document_viewed",timestamp:new Date().toISOString(),actor:h.employees?.name||"unknown",details:`문서 확인: ${t.title}`})}catch(t){console.error("Audit log error:",t)}},className:`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition ${r===g?"bg-blue-600 text-white":"signed"===t.status?"bg-green-50 text-green-700":"bg-gray-100 text-gray-600 hover:bg-gray-200"}`,children:["signed"===t.status&&"✓ ",t.title]},t.id))})}),(0,e.jsx)("div",{className:"max-w-3xl mx-auto px-4 py-6",children:q?.status==="signed"?(0,e.jsxs)("div",{className:"bg-white rounded-2xl border border-green-200 p-6 text-center",children:[(0,e.jsx)("div",{className:"w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3",children:(0,e.jsx)("svg",{className:"w-6 h-6 text-green-600",fill:"none",stroke:"currentColor",strokeWidth:"2.5",viewBox:"0 0 24 24",children:(0,e.jsx)("polyline",{points:"20 6 9 17 4 12"})})}),(0,e.jsx)("p",{className:"text-green-700 font-semibold",children:"이 문서는 서명 완료되었습니다"}),(0,e.jsxs)("p",{className:"text-xs text-gray-400 mt-1",children:["서명 시각: ",q.signed_at?new Date(q.signed_at).toLocaleString("ko-KR"):"-"]})]}):(0,e.jsxs)(e.Fragment,{children:[(0,e.jsxs)("div",{className:"bg-white rounded-2xl border border-gray-200 p-6 md:p-8 mb-6 shadow-sm",children:[W?.title&&(0,e.jsx)("h2",{className:"text-xl font-bold text-center text-gray-900 mb-6 pb-4 border-b border-gray-100",children:W.title}),W?.sections?.map((t,r)=>(0,e.jsxs)("div",{className:"mb-5",children:[t.heading&&(0,e.jsx)("h3",{className:"text-sm font-bold text-gray-800 mb-2",children:t.heading}),(0,e.jsx)("p",{className:"text-sm text-gray-600 leading-relaxed whitespace-pre-wrap",children:t.body})]},r))]}),(0,e.jsxs)("div",{className:"bg-white rounded-2xl border border-gray-200 p-6 shadow-sm",children:[(0,e.jsx)("h3",{className:"text-sm font-bold text-gray-800 mb-4",children:"서명"}),!b&&(0,e.jsxs)("div",{className:"space-y-3",children:[k&&(0,e.jsxs)("button",{onClick:()=>x("saved"),className:"w-full py-4 rounded-xl border-2 border-blue-200 bg-blue-50 hover:border-blue-400 transition text-center",children:[(0,e.jsxs)("div",{className:"flex items-center justify-center gap-2 mb-2",children:[(0,e.jsx)("svg",{className:"w-5 h-5 text-blue-600",fill:"none",stroke:"currentColor",strokeWidth:"2",viewBox:"0 0 24 24",children:(0,e.jsx)("polyline",{points:"20 6 9 17 4 12"})}),(0,e.jsx)("span",{className:"text-sm font-semibold text-blue-700",children:"저장된 서명 사용"})]}),"draw"===k.type?(0,e.jsx)("img",{src:k.data,alt:"저장된 서명",className:"h-12 mx-auto opacity-60"}):(0,e.jsx)("span",{className:"text-xl italic text-blue-800",style:{fontFamily:"cursive, serif"},children:k.data})]}),(0,e.jsxs)("div",{className:"flex gap-3",children:[(0,e.jsxs)("button",{onClick:()=>x("draw"),className:"flex-1 py-4 rounded-xl border-2 border-dashed border-gray-300 hover:border-blue-400 hover:bg-blue-50 transition text-center",children:[(0,e.jsx)("svg",{className:"w-6 h-6 mx-auto mb-1 text-gray-400",fill:"none",stroke:"currentColor",strokeWidth:"1.5",viewBox:"0 0 24 24",children:(0,e.jsx)("path",{d:"M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z"})}),(0,e.jsx)("span",{className:"text-xs font-medium text-gray-600",children:"직접 그리기"})]}),(0,e.jsxs)("button",{onClick:()=>x("type"),className:"flex-1 py-4 rounded-xl border-2 border-dashed border-gray-300 hover:border-blue-400 hover:bg-blue-50 transition text-center",children:[(0,e.jsx)("svg",{className:"w-6 h-6 mx-auto mb-1 text-gray-400",fill:"none",stroke:"currentColor",strokeWidth:"1.5",viewBox:"0 0 24 24",children:(0,e.jsx)("path",{d:"M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"})}),(0,e.jsx)("span",{className:"text-xs font-medium text-gray-600",children:"텍스트 입력"})]})]})]}),"saved"===b&&k&&(0,e.jsxs)("div",{children:[(0,e.jsxs)("div",{className:"p-6 bg-gray-50 rounded-xl border-2 border-blue-200 text-center mb-4",children:[(0,e.jsx)("p",{className:"text-xs text-gray-500 mb-2",children:"저장된 서명"}),"draw"===k.type?(0,e.jsx)("img",{src:k.data,alt:"서명",className:"h-16 mx-auto"}):(0,e.jsx)("p",{className:"text-3xl italic text-gray-800",style:{fontFamily:"cursive, serif"},children:k.data})]}),(0,e.jsxs)("div",{className:"flex gap-2",children:[(0,e.jsx)("button",{onClick:()=>x(null),className:"px-4 py-2.5 text-sm rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50",children:"다른 방식"}),(0,e.jsx)("button",{onClick:L,disabled:j,className:"flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition disabled:opacity-50",children:j?"처리 중...":"서명 완료"})]})]}),"draw"===b&&(0,e.jsxs)("div",{children:[(0,e.jsxs)("div",{className:"relative border-2 border-gray-200 rounded-xl overflow-hidden mb-3",children:[(0,e.jsx)("canvas",{ref:B,width:600,height:200,className:"w-full h-[150px] cursor-crosshair touch-none bg-gray-50",onMouseDown:O,onMouseMove:R,onMouseUp:U,onMouseLeave:U,onTouchStart:O,onTouchMove:R,onTouchEnd:U}),(0,e.jsx)("button",{onClick:D,className:"absolute top-2 right-2 px-2 py-1 text-xs bg-white/80 hover:bg-white rounded border border-gray-200 text-gray-500",children:"지우기"})]}),(0,e.jsx)("p",{className:"text-xs text-gray-400 mb-4",children:"위 영역에 서명을 그려주세요"}),(0,e.jsxs)("div",{className:"flex gap-2",children:[(0,e.jsx)("button",{onClick:()=>{x(null),D()},className:"px-4 py-2.5 text-sm rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50",children:"취소"}),(0,e.jsx)("button",{onClick:L,disabled:j,className:"flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition disabled:opacity-50",children:j?"처리 중...":"서명 완료"})]})]}),"type"===b&&(0,e.jsxs)("div",{children:[(0,e.jsx)("input",{type:"text",value:v,onChange:t=>w(t.target.value),placeholder:"서명할 이름을 입력하세요",className:"w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-lg text-center mb-3 focus:outline-none focus:border-blue-500",style:{fontFamily:"cursive, serif",fontSize:"24px"}}),(0,e.jsx)("p",{className:"text-xs text-gray-400 mb-4",children:"서명으로 사용할 이름을 입력하세요"}),(0,e.jsxs)("div",{className:"flex gap-2",children:[(0,e.jsx)("button",{onClick:()=>{x(null),w("")},className:"px-4 py-2.5 text-sm rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50",children:"취소"}),(0,e.jsx)("button",{onClick:L,disabled:j||!v.trim(),className:"flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition disabled:opacity-50",children:j?"처리 중...":"서명 완료"})]})]})]})]})}),(0,e.jsx)("footer",{className:"border-t border-gray-200 bg-white mt-8",children:(0,e.jsx)("div",{className:"max-w-3xl mx-auto px-4 py-4 text-center",children:(0,e.jsx)("p",{className:"text-xs text-gray-400",children:"OwnerView 전자서명 시스템"})})})]})}t.s(["default",()=>d])},48503,t=>{t.v(e=>Promise.all(["static/chunks/adabfc2d4bff09a9.js"].map(e=>t.l(e))).then(()=>e(15833)))},70653,t=>{t.v(e=>Promise.all(["static/chunks/049ce48f7172c019.js"].map(e=>t.l(e))).then(()=>e(24154)))},95111,t=>{t.v(e=>Promise.all(["static/chunks/dfff2fc9aec5c357.js"].map(e=>t.l(e))).then(()=>e(38201)))}]);