/**
 * espider Web browser interface
 *
 * v1.3.0
 * 
 * + v1.3.0 [20170614 djlee]
 * 		- add show_log configuration. 
 * 		- add _log() function for show_log configuration.
 * 		- deprecate _logger (use _log() instead)
 * 		- print caller on log.
 * 
 * 
 * Support email : heenam.dev@gmail.com
 *
 * Copyright (c) Heenam Co.,Ltd All Rights Reserved
 *
 **/

var codefcert = {
	_connectedType 		: (typeof WebSocket !== "undefined"?2:(typeof espiderIO == "function"?1:0)),
	_port				: 49152,
	_connected			: false,
	_checkLicense		: false,
	_checkLicenseCode	: "",
	_logger 			: (typeof console == "object"?console:{log:function(){/*nothing*/}}), // FIXME Deprecated : use _log() instead of _logger.console.log.
	_socket				: null,
	_iframe				: null,
	script_version 		: "1.3.0",
	engine_version		: "1.0.1",
	security			: false,
	_maxSendSize : 50000,
	_timerInter			: null,
	_jobRunning			: false,
	_jobInfo			: {},
	
	_show_log			: true,
	_print_caller		: true,
	options				: {},
	_log 				: function(msg){
		if(typeof console != "object" || !this._show_log){
			return;
		}
		
		if(!this._print_caller){
			console.log(msg);
		}else{
			try {
				throw Error('')
			} catch (err) {
				try {
					var callerLine = err.stack.split("\n")[2];
					var caller = callerLine.slice(callerLine.lastIndexOf("/") + 1, callerLine.length);
					console.log("[" + caller + "] " + msg);
				} catch (err2) {
					console.log(msg);
				}
			}
		}
	},
	
	_getVersion			: function(callback) {
		$.ajax({
			url : this.security?"https://local.espider.co.kr:24646/getVersion.esm":"http://local.espider.co.kr:24645/getVersion.esm",
			type: "GET",
			dataType : "jsonp",
			jsonp : "codefcert_call",
			timeout: 5000,
			success : function(data){
				if(data != null) {
					var version = data.version;		// Current Version
			
					// check version
					if(version >= codefcert.engine_version) {
						callback(true);
					} else {
						// TODO Update Process
						callback(false, "E010001");
					}
				}
			},
			error: function(XHR, textStatus, errorThrown) {
				callback(false, "E010002");
			}
		});
	},

	_getPort			: function(callback) {
		$.ajax({
			url : this.security?"https://local.espider.co.kr:24646/getPort.esm":"http://local.espider.co.kr:24645/getPort.esm",
			dataType : "jsonp",
			jsonp : "codefcert_call",
			timeout: 5000,
			success : function(data){
				if(data != null && data.success) {
					codefcert._port = data.port;			// available port
					// console.log(data.port);
					// codefcert._port = 55959;
					//excute espiderWin
					if(!codefcert._connected) {
						codefcert._connect();
					}
					callback(true);
				} else {
					callback(false, "E020001");
				}
			},
			error: function(XHR, textStatus, errorThrown) {
				callback(false, "E020002");
			}
		});
	},
		
	_connect			: function(call_back) {
		address = this.security?"wss://local.espider.co.kr":"ws://local.espider.co.kr";
		
		if (this._connected) return true;
		switch (this._connectedType) {
			case 1:
				//not support
				return false;
			case 2:
        this._socket = new WebSocket(address + ":" + this._port);
        
				this._socket.onopen = this._Engine_onopen;
				this._socket.onmessage = this._Engine_onmessage;
				this._socket.onclose = this._Engine_onclose;
				this._socket.onerror = this._Engine_onerror;
				break;
			default:
				return false;
		}
	},
	_disablePort		: [],
	
	_disconnect			: function() {
		codefcert._log("_disconnect");
		switch (this._connectedType) {
			case 1:
				if (!this._connected) return;
				this._socket.close();
				break;
			case 2:
				if (!this._connected) return;
				this._socket.close();
				break;
			default:
				return;
		}
	},
	
	_listener 			: {},
	
	addListner 			: function(name, fcall_back) {
		if (name && fcall_back && (typeof name === "string") && (typeof fcall_back === "function")) {
			this._listener[name] = fcall_back;
		} 
	},
	
	_sendcommand		: function(cmd, data) {
		if (!this._connected) return;
		
		switch (this._connectedType) {
			case 1:
			    codefcert._log("not support socket.io");
				return false;
				break;
			case 2:
				var sockData = [];
				sockData.push(cmd);
				sockData.push(((data && (typeof data === "object"))?data:""));
				this._socket.send(JSON.stringify(sockData));	
				break;
			default:
				return false;
		}
	},
	
	_Engine_onopen		: function() {
		codefcert._log("onopen");
		codefcert._connected = true;
        
		codefcert._socket = this;
		codefcert._sendcommand("codefcert_setOptions", codefcert.options);

		codefcert.engineCheckLicense(function (result){
			if (result == null || typeof result === "undefined") {
				codefcert._log("codefcert license check fail");
			} else {
				codefcert._log(JSON.stringify(result));
			}
		});
		
	},
	
	_Engine_onclose		: function(evt) {
		codefcert._log("onclose");
		codefcert._connected = false;
	},

	_Engine_onmessage	: function(back_data) {
		if (!back_data) return;
		try {
			switch (codefcert._connectedType) {
				case 2 :
					var data = back_data.data;
				
					if (data && (typeof data === "string")) {
						var retData = JSON.parse(data);
						if (retData[0] === "codefcert" && retData.length == 2) {
							var datas = retData[1];
							if (typeof datas.call_back == "string") {
								// checklicense
								if (datas.call_back == 'codefcert_checkLicense') {
									if (datas.data) {
										if (datas.data.code == 'CF-00000') {
											codefcert._checkLicense = true;
										}
										codefcert._checkLicenseCode = datas.data.code;
									}
								}
							
								var fn = codefcert._listener[datas.call_back];
								
								if (fn && (typeof fn === "function")) {
									fn(datas.data);
								} else if (typeof fn === "object") {
									//array
									fn = fn.shift();
									if (fn && (typeof fn === "function")) {
										fn(datas.data);	
									}
								}
							}
						}
					}
			
					break;
				case 1 :
					if (typeof back_data == "object") {
						var fn = codefcert._listener[back_data.call_back];
						if (fn && (typeof fn === "function")) {
							fn(back_data.data);
						} else if (typeof fn === "object") {
							//array
							fn = fn.shift();
							if (fn && (typeof fn === "function")) {
								fn(back_data.data);	
							}
						}
					}
					break;
				default:
					return;
			}
		} catch(e) {
			codefcert._log("onmessage err :: " + e);
		}
	},
	
	_Engine_onerror		: function(evt) {
		codefcert._log(evt);
	},
	
	_terminate			: function() {
		this._sendcommand("codefcert_terminate", "");
	},
	
	initialization		: function(call_back) {
		// Check Protocol
		var url = window.location.href
		var protocol = url.split(":")[0];
		
		codefcert._log("url :: " + url);
		codefcert._log("protocol :: " + protocol);
		codefcert._log("this.security :: " + this.security);
		
		if(protocol == "https") {
			this.security = true;
		}
		
		this.security = true;

		if (this._connected) {
			if (call_back && typeof call_back === "function") {
				call_back(true);
			}
			return;
		}
		
		codefcert._getVersion(function callback(callback_version) {
			if(callback_version) {
				codefcert._getPort(function callback(callback_port) {
					if(callback_port) {
						call_back(callback_port);
					} else {
						call_back(arguments[0], arguments[1]);
					}
				});
			} else {
				call_back(arguments[0], arguments[1]);
			}
		});
	},
	
	finalization		: function() {
		if (this._connected) {
			this._terminate();
			this._disconnect();
		}
	},
	
	engineVersion		: function(call_back) {
		if (!this._connected) {
			if (call_back && typeof call_back === "function") {
				call_back({"SUCCESS":false});
			}
		}
		
		if (!this._checkLicense) {
			if (call_back && typeof call_back === "function") {
				call_back({"SUCCESS":false, "ERROR_CODE":this._checkLicenseCode});
				return;
			}
		}
		
		if (call_back && typeof call_back === "function") {
			if (!this._listener["codefcert_getVersion"])
				this._listener["codefcert_getVersion"] = [];
				
			this._listener["codefcert_getVersion"].push(call_back);
		}
		this._sendcommand("codefcert_getVersion", null);
	},
	
	engineGetCertification: function(drive, call_back) {
		if (!this._connected) {
			if (call_back && typeof call_back === "function") {
				call_back({"SUCCESS":false});
				return;
			}
		}
		
		if (!this._checkLicense) {
			if (call_back && typeof call_back === "function") {
				call_back({"SUCCESS":false, "ERROR_CODE":this._checkLicenseCode});
				return;
			}
		}
		
		if (call_back && typeof call_back === "function") {
			if (!this._listener["codefcert_getCertification"])
				this._listener["codefcert_getCertification"] = [];
				
			this._listener["codefcert_getCertification"].push(call_back);
		}

		var external = {};
		external.external = "";
		if (drive && typeof drive === "string") {
			external.external = drive;
		}
		
		if (external.external != "") {
			this._sendcommand("codefcert_getCertification", external);
		} else {
			this._sendcommand("codefcert_getCertification", "");
		}
	},
	
	engineGetExternalDrive: function(call_back) {
		if (!this._connected) {
			if (call_back && typeof call_back === "function") {
				call_back({"SUCCESS":false});
				return;
			}
		}
		
		if (!this._checkLicense) {
			if (call_back && typeof call_back === "function") {
				call_back({"SUCCESS":false, "ERROR_CODE":this._checkLicenseCode});
				return;
			}
		}
		
		if (call_back && typeof call_back === "function") {
			if (!this._listener["codefcert_getExternalDrive"])
				this._listener["codefcert_getExternalDrive"] = [];
				
			this._listener["codefcert_getExternalDrive"].push(call_back);
		}
		this._sendcommand("codefcert_getExternalDrive", "");
	},
	
	engineGetDevice : function(infoKey, call_back) {
		
	  if (!this._connected) {
	   if (call_back && typeof call_back === "function") {
	    call_back({"SUCCESS":false});
	    return;
	   }
	  }
	  
		if (!this._checkLicense) {
			if (call_back && typeof call_back === "function") {
				call_back({"SUCCESS":false, "ERROR_CODE":this._checkLicenseCode});
				return;
			}
		}
	  
	  if(infoKey){
	  	var data = {};
	  	data.info = infoKey;
	  	
	  	if (call_back && typeof call_back == "function") {
		   if (!this._listener["codefcert_getDeviceInfo"])
		    this._listener["codefcert_getDeviceInfo"] = [];
		   
		   this._listener["codefcert_getDeviceInfo"].push(call_back);
		  }
		  
		  this._sendcommand("codefcert_getDeviceInfo", data);
	  }
 	},
 	
 	// 2019. 10. 18 추가
 	engineGetExportCertificationB64 : function(data, call_back) {
		if (!this._connected || !data ) {
			if (call_back && typeof call_back === "function") {
				call_back({"SUCCESS":false});
				return;
			}
		}
		
		if (!this._checkLicense) {
			if (call_back && typeof call_back === "function") {
				call_back({"SUCCESS":false, "ERROR_CODE":this._checkLicenseCode});
				return;
			}
		}
		
		if (call_back && typeof call_back == "function") {
			if (!this._listener["codefcert_getExportCertificationB64"])
				this._listener["codefcert_getExportCertificationB64"] = [];
				
			this._listener["codefcert_getExportCertificationB64"].push(call_back);
		}
		
		this._sendcommand("codefcert_getExportCertificationB64", data);
	},
		
	
	// 2020. 07. 01 추가
	engineImportCertificationB64 : function(data, call_back) {
		if (!this._connected || !data ) {
			if (call_back && typeof call_back === "function") {
				call_back({"SUCCESS":false});
				return;
			}
		}
		
		if (!this._checkLicense) {
			if (call_back && typeof call_back === "function") {
				call_back({"SUCCESS":false, "ERROR_CODE":this._checkLicenseCode});
				return;
			}
		}		

		
		if (call_back && typeof call_back == "function") {
			if (!this._listener["codefcert_ImportCertificationB64"])
				this._listener["codefcert_ImportCertificationB64"] = [];
				
			this._listener["codefcert_ImportCertificationB64"].push(call_back);
		}
		
		this._sendcommand("codefcert_ImportCertificationB64", data);
	},
	// 2021.04.15 achee7059 add
	engineCheckLicense: function(call_back) {
		if (!this._connected) {
			if (call_back && typeof call_back === "function") {
				call_back({"SUCCESS":false});
			}
		}
		
		if (call_back && typeof call_back === "function") {
			if (!this._listener["codefcert_checkLicense"])
				this._listener["codefcert_checkLicense"] = [];
				
			this._listener["codefcert_checkLicense"].push(call_back);
		}
		
		codefcert._sendcommand("codefcert_checkLicense", codefcert.options);
	}
};


