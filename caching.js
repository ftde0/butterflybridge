const fs = require("fs")

const debugWrite = true;
let tables = {
    "postImages": {},
    "tempCursors": {},
    "userLookupTable": {},
    "handleDidTable": {},
    "postLookupTable": {},
    "listLookupTable": {},
    "rkeyLookupTable": []
}
if(fs.existsSync("./bsky-data.json")) {
    try {
        let f = JSON.parse(fs.readFileSync("./bsky-data.json").toString())
        tables.userLookupTable = f.lookupTables.userLookupTable;
        tables.handleDidTable = f.lookupTables.handleDidTable;
        tables.postLookupTable = f.lookupTables.postLookupTable;
        tables.listLookupTable = f.lookupTables.listLookupTable;
        tables.rkeyLookupTable = f.lookupTables.rkeyLookupTable
        tables.postImages = f.lookupTables.postImages;
    }
    catch(error) {}
}

let changeQueue = 0;
let changeThreshold = 3;
if(!debugWrite) {changeThreshold = 20;}

module.exports = {
    "commitChanges": function() {
        changeQueue++
        if(changeQueue >= changeThreshold) {
            fs.writeFileSync("./bsky-data.json", JSON.stringify({
                "lookupTables": {
                    "userLookupTable": tables.userLookupTable,
                    "postLookupTable": tables.postLookupTable,
                    "listLookupTable": tables.listLookupTable,
                    "rkeyLookupTable": tables.rkeyLookupTable,
                    "handleDidTable": tables.handleDidTable,
                    "postImages": tables.postImages
                }
            }))
            changeQueue = 0;
        }
    },

    "getTable": function(table) {
        return tables[table];
    },

    "write": function(table, index, data, absolute) {
        if(table == "rkeyLookupTable") {
            if(absolute) {
                tables[table] = data;
            } else {
                tables.push(data)
            }
            return;
        }
        tables[table][index] = data;
    }
}