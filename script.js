class AudioLoader {
    constructor(dropZone) {
        this.dropZone = dropZone;
    }

    updateProgressMessage(message) {
        this.dropZone.querySelector(".progressmessage").innerText = message;
    }

    updateProgressBar(current, total) {
        this.dropZone.querySelector(".progressbar .progressmarker").style.width = `${current / total * 100}%`
    }

    async loadMetadata(file) {
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
        return {
            "zip": zip,
            "albums": albums
        };
    }

    async loadAudio(zip, albums) {
        let numTracks = albums.reduce((n, album) => n + (album["tracks"] || []).length, 0);
        let numProcessed = 0;
        this.updateProgressMessage("Loading audio files...");
        this.updateProgressBar(0, 1);
        let results = [];
        for (let album of albums) {
            let tracks = [];
            let seekPosition = 0;
            for (let track of album["tracks"]) {
                let filename = `${album["directory"]}/${track["filename"]}`;
                try {
                    let data = await zip.file(filename).async("arraybuffer");
                    let blob = new Blob([data], {"type": "audio/mp3"});
                    let url = URL.createObjectURL(blob);
                    track["url"] = url;
                    track["seek"] = seekPosition;
                    track["duration"] = await this.getDuration(url);
                    seekPosition += track["duration"];
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
        return results;
    }

    async getDuration(url) {
        let audio = new Audio();
        let promise = new Promise(resolve => {
            audio.addEventListener("durationchange", event => resolve(audio.duration));
        });
        audio.src = url;
        let duration = await promise;
        return duration;
    }
}

class AudioPlayer {
    constructor(player, albumList, trackList, dropZone, recordElement, needleElement) {
        // HTML elements
        this.player = player;
        this.albumList = albumList;
        this.trackList = trackList;
        this.dropZone = dropZone;
        this.recordElement = recordElement;
        this.needleElement = needleElement;
        // Data
        this.lastDropTarget = null;
        this.music = null;
        this.selectedAlbum = -1;
        this.playingAlbum = -1;
        this.playingTrack = -1;
        // State
        this.loader = new AudioLoader(dropZone);
        this.controller = new AudioAnimationController(
            recordElement,
            needleElement,
            player,
            () => this.music
        );
        this.animator = new AudioAnimator(this.controller);
        this.animationFrame = null;
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
                } else {
                    this.dropZone.classList.remove("active");
                    this.dropZone.classList.remove("loading");
                    break;
                }
            }
        });
    }

    initAudioControl() {
        this.recordElement.addEventListener("click", event => {
            this.toggleAudio();
        });
        this.needleElement.addEventListener("click", event => {
            this.toggleAudio();
        });
        document.addEventListener("keypress", event => {
            if (event.key == " ") {
                this.toggleAudio();
            }
        });
        // TODO: Fix
        // this.player.addEventListener("pause", event => {
        //     this.pauseAudio();
        // });
        // this.player.addEventListener("play", event => {
        //     this.playAudio();
        // });
        this.player.addEventListener("ended", event => {
            if (this.selectedAlbum == this.playingAlbum) {
                this.selectTrack((this.playingTrack + 1) % this.music[this.selectedAlbum]["tracks"].length);
            } else {
                this.playingTrack = (this.playingTrack + 1) % this.music[this.selectedAlbum]["tracks"].length;
                this.playAudio();
            }
        });
        this.controller.resize();
        window.addEventListener("resize", event => {
            this.controller.resize();
        });
        window.requestAnimationFrame(this.animate.bind(this));
    }

    async load(file) {
        this.animator.reset();
        // Load metadata
        let {zip, albums} = await this.loader.loadMetadata(file);
        // Link audio files
        let results = await this.loader.loadAudio(zip, albums);
        // Reset UI
        this.loader.updateProgressMessage("Success!");
        this.loader.updateProgressBar(1, 1);
        this.music = results.length ? results : null;
        this.selectedAlbum = -1;
        this.playingAlbum = -1;
        this.playingTrack = -1;
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
        if (this.music == null || this.selectedAlbum == -1) return;
        const formatTime = time => `${Math.floor(time / 60)}:${time % 60 < 9.5 ? "0" : ""}${Math.round(time % 60)}`;
        for (let track of this.music[this.selectedAlbum]["tracks"]) {
            this.trackList.innerHTML += `
            <div class="entry">
                <span class="track-name">${track["title"]}</span>
                <span class="track-duration">(${formatTime(track["duration"])})</span>
            </div>
            `;
        }
        if (this.selectedAlbum == this.playingAlbum && this.playingTrack != -1) {
            this.trackList.querySelectorAll(".entry")[this.playingTrack].classList.add("playing");
        }
        // Add event listeners
        this.trackList.querySelectorAll(".entry").forEach((entry, index) => {
            entry.addEventListener("click", event => {
                this.selectTrack(index);
            });
        });
    }

    selectAlbum(index) {
        if (index == this.selectedAlbum) return;
        // UI update
        let entries = this.albumList.querySelectorAll(".entry");
        for (let entry of entries) {
            entry.classList.remove("selected");
        }
        if (index != -1) {
            entries[index].classList.add("selected");
        }
        // Internal update
        this.selectedAlbum = index;
        this.renderTracks();
    }

    selectTrack(index) {
        if (this.selectedAlbum == this.playingAlbum && index == this.playingTrack) {
            // Toggle play on currently playing track
            this.toggleAudio();
        } else {
            if (this.selectedAlbum == this.playingAlbum) {
                // Switch tracks
                let entries = this.trackList.querySelectorAll(".entry");
                for (let entry of entries) {
                    entry.classList.remove("selected");
                    entry.classList.remove("playing");
                }
                if (index != -1) {
                    entries[index].classList.add("selected");
                    entries[index].classList.add("playing");
                }
            } else {
                // Switch albums
                let entries = this.trackList.querySelectorAll(".entry");
                if (index != -1) {
                    entries[index].classList.add("selected");
                    entries[index].classList.add("playing");
                    // Update album as well
                    let albumEntries = this.albumList.querySelectorAll(".entry");
                    for (let entry of albumEntries) {
                        entry.classList.remove("playing");
                    }
                    albumEntries[this.selectedAlbum].classList.add("playing");
                }
            }
            this.playingAlbum = this.selectedAlbum;
            this.playingTrack = index;
            this.playAudio();
        }
    }

    // Control audio

    pauseAudio() {
        this.animator.stopAudio();
    }

    playAudio() {
        this.animator.setTarget(this.playingAlbum, this.playingTrack, true);
    }

    toggleAudio() {
        if (this.animator.play || this.playingTrack == -1) {
            this.pauseAudio();
        } else {
            this.playAudio();
        }
    }

    // Animation

    animate(time) {
        if (this.animationFrame == null) {
            this.animationFrame = time;
        }
        this.animator.update(time - this.animationFrame);
        this.animationFrame = time;
        window.requestAnimationFrame(this.animate.bind(this));
    }
}

var vinyl = new AudioPlayer(
    document.querySelector("audio#player"),
    document.querySelector("#menu .item-list"),
    document.querySelector("#info .item-list"),
    document.querySelector(".dropzone"),
    document.querySelector("#record"),
    document.querySelector("#record-needle")
);