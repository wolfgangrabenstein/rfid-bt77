/*global cordova, module*/

var RfidReaderPlugin = (function () {
    "use strict";
    var CORDOVA_PLUGIN_NAME = "RfidReader",
		CORDOVA_ACTION_SCAN_INVENTORY = "SCAN_INVENTORY",
		CORDOVA_ACTION_READ_TAG = "READ_TAG",
		CORDOVA_ACTION_WRITE_TAG = "WRITE_TAG",
		CORDOVA_ACTION_START_RFID_LISTENER = "START_RFID_LISTENER",
		CORDOVA_ACTION_STOP_RFID_LISTENER = "STOP_RFID_LISTENER",

		defaultValues = {
			inventoryCycles: 30,
			seenCountForFind: 5,
			seenCountAdvantageForFind: 5,
			retriesReadWrite: 20,
			inventoryCountThreshold: 0
		},
    // further attributes for args object
    //   epcToRead: epc
    //   epcToWrite: epc
    //   dataToWrite: epc
    //   dataFromReadResult: epc
		valueLimits = {
			maxInventoryCycles: 50,
			maxSeenCountForFind: 5,
			maxSeenCountAdvantageForFind: 5,
			maxRetriesReadWrite: 35,
			inventoryCountThreshold: 5
		},
		argsObject = {},
		argsArray = [],
		retryCount = 0,
		cycleCount = 0,
		seenCountForFind = 0,
		seenCountAdvantageForFind = 0,
		bInventoryUseBestAlgorithm = false,

		successCallback,
		errorCallback,
		inventoryProcessCallback;
    function debugLog(message) {
        console.log("rfidreader.js: " + message);
    }
    function isSet(checkVar) {
        return typeof (checkVar) != "undefined" && checkVar !== null && checkVar !== "";
    }
    /**
     * ensure that needed values are set in the argsObject
     * and set default values if initial or bad value ...
     */
	function checkArgsObject() {
        argsObject = argsArray[0];
        argsObject.inventoryCycles = Math.min(
            Math.max(1, parseInt(argsObject.inventoryCycles, 10)),
			valueLimits.maxInventoryCycles
		);
        if (isNaN(argsObject.inventoryCycles)) {
            argsObject.inventoryCycles = defaultValues.inventoryCycles;
        }
        // not an allowed "input args parameter", but has to be set for the java call
        if(bInventoryUseBestAlgorithm === true){
            argsObject.inventoryCyclesForJava = 1;
        }else{
            argsObject.inventoryCyclesForJava = argsObject.inventoryCycles;
        }
        argsObject.retriesReadWrite = Math.min(
            Math.max(1, parseInt(argsObject.retriesReadWrite, 10)),
            valueLimits.maxRetriesReadWrite
		);
        if (isNaN(argsObject.retriesReadWrite)) {
            argsObject.retriesReadWrite = defaultValues.retriesReadWrite;
        }
        argsObject.inventoryCountThreshold = Math.min(
            Math.max(1, parseInt(argsObject.inventoryCountThreshold, 10)),
            valueLimits.inventoryCountThreshold
        );
		if (isNaN(argsObject.inventoryCountThreshold)) {
            argsObject.inventoryCountThreshold = defaultValues.inventoryCountThreshold;
        }
        ["epcToRead", "epcToWrite", "dataToWrite"].forEach(function (ELEM) {
            if (!isSet(argsObject[ELEM])) {
                argsObject[ELEM] = "";
            }
        });

        seenCountForFind = Math.min(
            Math.max(1, parseInt(argsObject.seenCountForFind, 10)),
            valueLimits.maxSeenCountForFind
		);
        if (isNaN(seenCountForFind)) {
            seenCountForFind = defaultValues.seenCountForFind;
        }
        seenCountAdvantageForFind = Math.min(
            Math.max(1, parseInt(argsObject.seenCountAdvantageForFind, 10)),
            valueLimits.maxSeenCountAdvantageForFind
		);
        if (isNaN(seenCountAdvantageForFind)) {
            seenCountAdvantageForFind = defaultValues.seenCountAdvantageForFind;
        }
    }
    function getArgsArray(args) {
        // args auf erlaubten typ/inhalt prüfen
        // nur ein Object erlaubt, kein Array!
        if (typeof (args) != "object" || args === null || Array.isArray(args)) {
            args = {};
        }
        return [args];  // Array erstellen
    }
    function init(args, cbSuccess, cbError) {
        debugLog("args before init: " + JSON.stringify(args));
        argsArray = getArgsArray(args);
        checkArgsObject();
        successCallback = cbSuccess;
        errorCallback = cbError;
        cycleCount = 0;
        retryCount = 0;
        debugLog("argsObject at the end of init: " + JSON.stringify(argsObject));
    }
    function shutdown(argsArray, errorCallback) {
        if (typeof (errorCallback) != "function") {
            errorCallback = errorCallback;
        }
        cordova.exec(
            emptyCallback,
            errorCallback,
            CORDOVA_PLUGIN_NAME,
            CORDOVA_ACTION_STOP_RFID_LISTENER,
            argsArray
		);
    }
    function emptyCallback() {

    }


    /**
     * === scanInventory ===
     *   - callback: RfidReaderPlugin.inventoryProcessCallback
     *   - read details for a given Epc
     */
    function cordovaExecScanInventory() {
        cordova.exec(
            inventoryCycleSuccessCallback,
            inventoryCycleErrorCallback,
            CORDOVA_PLUGIN_NAME,
            CORDOVA_ACTION_SCAN_INVENTORY,
            argsArray
        );
    }
    function inventoryCycleSuccessCallback(args) {
        argsArray = args;
        argsObject = argsArray[0];
		
        if (bInventoryUseBestAlgorithm === true) {
            if (inventoryAdvantageReached() === true) {
                debugLog("inventoryAdvantageReached ... we have a winner!");
                inventoryProcessCallback();
            } else if (cycleCount < argsObject.inventoryCycles) {
                cycleCount = cycleCount + 1;
                debugLog("scanInventory ... starting another cycle: " + cycleCount +
                    " (max: " + argsObject.inventoryCycles + ")");
                cordovaExecScanInventory();
            } else {
                //debugLog("inventoryCycleSuccessCallback ... max cycles reached ... moving on to callback");
                //inventoryProcessCallback();
                var errString = "Maximum inventoryCycles reached ... no winner determined!";
                debugLog(errString);
                inventoryCycleErrorCallback(errString);
            }
        } else {        
            debugLog("inventoryCycleSuccessCallback ... finished");
            successCallback(argsArray);
        }
    }
    function inventoryCycleErrorCallback(message) {
        errorCallback(message);
        //shutdown(message, emptyCallback);
        shutdown(message);
    }
    function readBestTagFromInventory() {
        var epc = getBestEpcFromInventory(argsArray);
		debugLog("readBestTagFromInventory ... epc: " + epc);

        // set EPC into argsArray
        argsObject.epcToRead = epc;
        argsArray[0] = argsObject;

        cordovaExecReadTag();
    }
	function writeBestTagFromInventory() {
        var epc = getBestEpcFromInventory(argsArray);
		debugLog("writeBestTagFromInventory ... epc: " + epc);
		
		// set EPC into argsArray
		argsObject.epcToWrite = epc;
		argsArray[0] = argsObject;

		cordovaExecWriteTag();
    }
    function getBestEpcFromInventory() {
        debugLog("getBestEpcFromInventory ... processing results ...");
        var maxSeenCountEpc = null,
			maxSeenCountValue = -1;
        Object.keys(argsObject.inventory).forEach(function (epc) {
            var seenCount = argsObject.inventory[epc];
            debugLog("Inventory-Entry: epc(" + epc + "), seenCount(" + seenCount + ")");
            if (seenCount > maxSeenCountValue) {
                maxSeenCountEpc = epc;
                maxSeenCountValue = seenCount;
            }
        });
        return maxSeenCountEpc;
    }
    function inventoryAdvantageReached() {
        debugLog("inventoryAdvantageReached ... checking current inventory ...");
        var maxSeenCountEpc = null,
			maxSeenCountValue = 0,
			secondMostSeenCountEpc = null,
			secondMostSeenCountValue = 0;
        Object.keys(argsObject.inventory).forEach(function (epc) {
            var seenCount = argsObject.inventory[epc];
            debugLog("find max - Inventory-Entry: epc(" + epc + "), seenCount(" + seenCount + ")");
            if (seenCount > maxSeenCountValue) {
                maxSeenCountEpc = epc;
                maxSeenCountValue = seenCount;
            }
        });
        Object.keys(argsObject.inventory).forEach(function (epc) {
            if (epc == maxSeenCountEpc) {
                return;     // do not use the epc already in first place with highest seenCount
            }
            var seenCount = argsObject.inventory[epc];
            debugLog("find second most - Inventory-Entry: epc(" + epc + "), seenCount(" + seenCount + ")");
            if (seenCount > secondMostSeenCountValue) {
                secondMostSeenCountEpc = epc;
                secondMostSeenCountValue = seenCount;
            }
        });
        if (maxSeenCountValue - secondMostSeenCountValue >= seenCountAdvantageForFind) {
            return true;
        }
        return false;
    }
    function returnInventory() {
        debugLog("returnInventory");
    }




    /**
     * === readTag ===
     *   - callback: successCallback/errorCallback
     *     (application submitted callback function)
     *   - read details for a given Epc
     */
    function cordovaExecReadTag() {
        cordova.exec(
            readRetrySuccessCallback,
            readRetryErrorCallback,
            CORDOVA_PLUGIN_NAME,
            CORDOVA_ACTION_READ_TAG,
            argsArray
		);
    }
    function readRetrySuccessCallback(message) {
        successCallback(message);
        shutdown(message);
    }
    function readRetryErrorCallback(message) {
        errorCallback(message);
        shutdown(message);
    }


    /**
     * === writeTag ===
     *   - callback: successCallback/errorCallback
     *     (application submitted callback function)
     *   - write new Epc for a given Epc
     */
    function cordovaExecWriteTag() {
        cordova.exec(
            writeRetrySuccessCallback,
            writeRetryErrorCallback,
            CORDOVA_PLUGIN_NAME,
            CORDOVA_ACTION_WRITE_TAG,
            argsArray
		);
    }
    function writeRetrySuccessCallback(message) {
        successCallback(message);
        shutdown(message);
    }
	
	function writeRetryErrorCallback(message) {
		errorCallback(message);
		shutdown(message);
    }


    /**
     *  PUBLIC FUNCTIONS for the plugin
     */
	function scanAndReadBestTag(args, successCallback, errorCallback) {
        debugLog("starting scanAndReadBestTag");
        bInventoryUseBestAlgorithm = true;
		// init the plugin class
        init(args, successCallback, errorCallback);
        // set the necessary follow-up action ... (because scan and read are separate API calls)
        inventoryProcessCallback = readBestTagFromInventory;
        // ... before initiating the scan
        cordovaExecScanInventory();
    }
	function scanAndWriteBestTag(args, successCallback, errorCallback) {
        debugLog("starting scanAndWriteBestTag");
        bInventoryUseBestAlgorithm = true;
		// init the plugin class
        init(args, successCallback, errorCallback);
        // set the necessary follow-up action ... (because scan and read are separate API calls)
        inventoryProcessCallback = writeBestTagFromInventory;
        // ... before initiating the scan
        cordovaExecScanInventory();
    }
    function scanInventory(args, successCallback, errorCallback) {
        debugLog("starting scanInventory");
        bInventoryUseBestAlgorithm = false;
		// init the plugin class
        init(args, successCallback, errorCallback);
        cordovaExecScanInventory();
    }
    function readTag(args, successCallback, errorCallback) {
        // init the plugin class
        init(args, successCallback, errorCallback);
        // call the readTag API
        cordovaExecReadTag();
    }
    function writeTag(args, successCallback, errorCallback) {
        // init the plugin class
        init(args, successCallback, errorCallback);
        // call the writeTag API
        cordovaExecWriteTag();
    }
    // calls only for test purposes, should not be necessary to be called by applications
    function startRfidListener(args, successCallback, errorCallback) {
        var argsArray = getArgsArray(args);
        cordova.exec(successCallback, errorCallback, CORDOVA_PLUGIN_NAME, CORDOVA_ACTION_START_RFID_LISTENER, argsArray);
    }
    function endRfidListener(args, successCallback, errorCallback) {
        var argsArray = getArgsArray(args);
        cordova.exec(successCallback, errorCallback, CORDOVA_PLUGIN_NAME, CORDOVA_ACTION_STOP_RFID_LISTENER, argsArray);
    }
    return {
        scanAndReadBestTag: scanAndReadBestTag,
		scanAndWriteBestTag: scanAndWriteBestTag,
        readTag: readTag,
        writeTag: writeTag,
        startRfidListener: startRfidListener,
        endRfidListener: endRfidListener,
        scanInventory: scanInventory
    };


}());

module.exports = {
    scanAndReadBestTag: RfidReaderPlugin.scanAndReadBestTag,
    scanAndWriteBestTag: RfidReaderPlugin.scanAndWriteBestTag,
    scanInventory: RfidReaderPlugin.scanInventory,
    readTag: RfidReaderPlugin.readTag,
    writeTag: RfidReaderPlugin.writeTag,
    // calls only for test purposes, should not be necessary to be called by applications
    startRfidListener: RfidReaderPlugin.startRfidListener,
    endRfidListener: RfidReaderPlugin.endRfidListener

};


