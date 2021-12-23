class AudioPlayer {
    constructor(player, albumList, trackList, dropZone, audioController) {
        // HTML elements
        this.player = player;
        this.albumList = albumList;
        this.trackList = trackList;
        this.dropZone = dropZone;
        this.audioController = audioController;
        // Data
        this.lastDropTarget = null;
        this.music = null;
        this.albumIndex = -1;
        this.trackIndex = -1;
        this.playing = false;
        this.rotation = 0;
        this.lastTimestamp = 0;
        // Init
        this.initFileUpload();
        this.initAudioControl();
    }

    initFileUpload() {
        window.addEventListener("dragenter", event => {
            this.lastDropTarget = event.target;
            this.dropZone.classList.add("active");
        });
        window.addEventListener("dragleave", event => {
            if (event.target === this.lastDropTarget || event.target === document) {
                this.dropZone.classList.remove("active");
            }
        });
        window.addEventListener("dragover", event => {
            event.preventDefault();
            event.stopPropagation();
        });
        window.addEventListener("drop", event => {
            event.preventDefault();
            // Read only one file
            for (let infile of event.dataTransfer.files) {
                if (infile.name.endsWith(".zip")) {
                    this.load(infile).catch(err => {
                        console.warn(err);
                        this.dropZone.classList.remove("active");
                        this.dropZone.classList.remove("loading");
                    });
                }
            }
        });
    }

    initAudioControl() {
        this.audioController.addEventListener("click", event => {
            this.togglePlay();
        });
        this.player.addEventListener("ended", event => {
            this.togglePlay(false);
        });
        window.requestAnimationFrame(this.animate.bind(this));
    }

    updateProgressMessage(message) {
        this.dropZone.querySelector(".progressmessage").innerText = message;
    }

    updateProgressBar(current, total) {
        this.dropZone.querySelector(".progressbar .progressmarker").style.width = `${current / total * 100}%`
    }

    async load(file) {
        this.updateProgressMessage("Reading ZIP file...");
        this.updateProgressBar(0, 1);
        this.dropZone.classList.add("loading");
        // Load zip file
        let zip = await JSZip.loadAsync(file);
        let zipData = [];
        zip.forEach((path, entry) => zipData.push([path, entry]));
        // Parse metadata files
        this.updateProgressMessage("Loading music metadata...");
        this.updateProgressBar(0, 1);
        let albums = [];
        for (let i in zipData) {
            let [path, entry] = zipData[i];
            if (path.endsWith("metadata.json")) {
                let data = await entry.async("string");
                try {
                    data = JSON.parse(data);
                    let filepath = path.split("/");
                    filepath.pop();
                    data["directory"] = filepath.join("/");
                    // Check for album cover
                    if ("cover" in data && data["cover"] != null) {
                        let filename = `${data["directory"]}/${data["cover"]}`;
                        let imagedata = await zip.file(filename).async("arraybuffer");
                        let blob = new Blob([imagedata], {"type": "image/png"});
                        let url = URL.createObjectURL(blob);
                        data["image"] = url;
                    } else {
                        data["image"] = null;
                    }
                    albums.push(data);
                } catch (err) {
                    console.warn(`Invalid metadata file: '${path}'`);
                }
            }
            this.updateProgressBar(i + 1, zipData.length);
        }
        // Link audio files
        let numTracks = albums.reduce((n, album) => n + (album["tracks"] || []).length, 0);
        let numProcessed = 0;
        this.updateProgressMessage("Loading audio files...");
        this.updateProgressBar(0, 1);
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
                numProcessed++;
                this.updateProgressBar(numProcessed, numTracks);
            }
            album["tracks"] = tracks;
            if (tracks.length) results.push(album);
        }
        // Reset UI
        this.updateProgressMessage("Success!");
        this.updateProgressBar(1, 1);
        this.music = results.length ? results : null;
        this.albumIndex = -1;
        this.trackIndex = -1;
        this.dropZone.classList.remove("active");
        this.dropZone.classList.remove("loading");
        window.setTimeout(this.renderAlbums.bind(this), 0);
    }

    renderAlbums() {
        for (let entry of this.albumList.querySelectorAll(".entry")) {
            entry.remove();
        }
        if (this.music == null) return;
        for (let album of this.music) {
            this.albumList.innerHTML += `
            <div class="entry">
                <span class="album-name">${album["name"]}</span><br />
                <span class="album-artist">${album["artist"]}</span>
            </div>
            `;
        }
        this.renderTracks();
        // Add event listeners
        this.albumList.querySelectorAll(".entry").forEach((entry, index) => {
            entry.addEventListener("click", event => {
                this.selectAlbum(index);
            });
        });
    }

    renderTracks() {
        for (let entry of this.trackList.querySelectorAll(".entry")) {
            entry.remove();
        }
        if (this.music == null || this.albumIndex == -1) return;
        for (let track of this.music[this.albumIndex]["tracks"]) {
            this.trackList.innerHTML += `
            <div class="entry">
                <span class="track-name">${track["title"]}</span>
            </div>
            `;
        }
        // Add event listeners
        this.trackList.querySelectorAll(".entry").forEach((entry, index) => {
            entry.addEventListener("click", event => {
                this.selectTrack(index);
            });
        });
    }

    selectAlbum(index) {
        // UI update
        let entries = this.albumList.querySelectorAll(".entry");
        for (let entry of entries) {
            entry.classList.remove("selected");
        }
        if (index != -1) {
            entries[index].classList.add("selected");
        }
        if (index == -1 || this.music[index]["image"] == null) {
            this.audioController.classList.remove("has-cover");
            this.audioController.querySelector(".album-cover").src = "";
        } else {
            this.audioController.querySelector(".album-cover").src = this.music[index]["image"];
            this.audioController.classList.add("has-cover");
        }
        // Internal update
        this.albumIndex = index;
        this.trackIndex = -1;
        this.renderTracks();
    }

    selectTrack(index) {
        // UI update
        let entries = this.trackList.querySelectorAll(".entry");
        for (let entry of entries) {
            entry.classList.remove("selected");
        }
        if (index != -1) {
            entries[index].classList.add("selected");
        }
        // Internal update
        this.trackIndex = index;
        if (index != -1) {
            this.player.src = this.music[this.albumIndex]["tracks"][this.trackIndex]["url"];
        }
    }

    togglePlay(value = null) {
        if (value == false || this.albumIndex == -1 || this.trackIndex == -1) {
            this.playing = false;
        } else if (this.playing && value != true) {
            this.player.pause();
            this.playing = false;
        } else if (!this.playing) {
            this.player.play();
            this.playing = true;
        }
    }

    animate(time) {
        if (this.playing) {
            this.rotation = this.rotation + (100/3) / 60 / 1000 * (time - this.lastTimestamp); // 45 RPM
            this.audioController.style.transform = `translate(-50%, -50%) rotateX(-10deg) rotateZ(${this.rotation}turn)`;
        }
        this.lastTimestamp = time;
        window.requestAnimationFrame(this.animate.bind(this));
    }
}

var vinyl = new AudioPlayer(
    document.querySelector("audio#player"),
    document.querySelector("#menu .item-list"),
    document.querySelector("#info .item-list"),
    document.querySelector(".dropzone"),
    document.querySelector("#record")
);
