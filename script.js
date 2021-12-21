// File upload
var lastDropTarget = null;
window.addEventListener("dragenter", function(event) {
    lastDropTarget = event.target;
    document.querySelector(".dropzone").classList.add("active");
});
window.addEventListener("dragleave", function(event) {
    if (event.target === lastDropTarget || event.target === document) {
        document.querySelector(".dropzone").classList.remove("active");
    }
});
window.addEventListener("drop", function(event) {
    event.preventDefault();
    document.querySelector(".dropzone").classList.remove("active");
    // Read only one file
    for (let infile of event.dataTransfer.files) {
        if (infile.name.endsWith(".zip")) {
            try {
                loadMusic(infile);
                break;
            } catch (err) {
                console.warn(err);
            }
        }
    }
});
window.addEventListener("dragover", function (event) {
    event.preventDefault();
    event.stopPropagation();
});

// Music loading
var music = null;
async function loadMusic(file) {
    let zip = await JSZip.loadAsync(file);
    let zipData = [];
    zip.forEach((path, entry) => zipData.push([path, entry]));
    // Parse metadata files
    let albums = [];
    for (let [path, entry] of zipData) {
        if (path.endsWith("metadata.json")) {
            let data = await entry.async("string");
            try {
                data = JSON.parse(data);
                let filepath = path.split("/");
                filepath.pop();
                data["directory"] = filepath.join("/");
                albums.push(data);
            } catch (err) {
                console.warn(`Invalid metadata file: '${path}'`);
            }
        }
    }
    // Link audio files
    let results = [];
    for (let album of albums) {
        let tracks = [];
        for (let track of album["tracks"]) {
            let filename = `${album["directory"]}/${track["filename"]}`;
            try {
                let data = await zip.file(filename).async("arraybuffer");
                let blob = new Blob([data], {"type": "audio/mp3"});
                let url = URL.createObjectURL(blob);
                track["url"] = url;
                tracks.push(track);
            } catch (err) {
                console.warn(`Invalid track file: '${filename}'`);
            }
        }
        album["tracks"] = tracks;
        if (tracks.length) results.push(album);
    }
    music = results.length ? results : null;
    window.setTimeout(updateDisplay, 0);
}

// UI
var audioPlayer = document.querySelector("audio#player");
document.querySelector("#record").addEventListener("click", function(event) {
    // TODO
    console.log("Playing");
    audioPlayer.play();
});
function updateDisplay() {
    // TODO
    if (music == null) return;
    let sampletrack = music[0]["tracks"][0];
    audioPlayer.src = sampletrack["url"];
    console.log("Loaded");
}