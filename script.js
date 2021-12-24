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

class AudioAnimator {
    constructor(target) {
        this.target = target;
        this.playing = false;
        this.queued = null;
        this.frame = 0;
        this.lastTimestamp = 0;
        this.rotation = 0;
        this.targetUrl = null;
        this.glowFrame = 0;
        // Modes
        this.ANIMATE_NONE = 0;
        this.ANIMATE_IDLE = 1;
        this.ANIMATE_SPIN = 2;
        this.ANIMATE_SWAP_END = 3;
        this.ANIMATE_SWAP_START = 4;
        this.animating = this.ANIMATE_NONE;
        // Settings
        this.DURATION_IDLE = 400;
        this.DURATION_SWAP = 600;
        this.SPEED_PLAYING = (100/3) / 60; // 33 1/3 RPM
        this.SPEED_WINDING = 45 / 60;
    }

    get isPlaying() { return this.playing || this.queued != null; }

    signalStop() {
        this.playing = false;
        this.queued = null;
    }

    signalStart(callback) {
        if (!this.playing) {
            this.queued = callback;
        }
    }

    signalRecordSpin(seek) {
        if (this.animating < this.ANIMATE_SPIN) {
            this.animating = this.ANIMATE_SPIN;
        }
        if (this.animating == this.ANIMATE_SPIN) {
            this.frame = ((this.rotation - seek % (1 / this.SPEED_PLAYING) + 1) % 1) / this.SPEED_WINDING * 1000;
        }
    }

    signalRecordSwap(url) {
        if (this.animating == this.ANIMATE_SWAP_END) {
            this.frame = this.DURATION_SWAP - this.frame;
        } else if (this.animating < this.ANIMATE_SWAP_END) {
            this.frame = this.DURATION_SWAP;
        }
        this.targetUrl = url;
        this.animating = this.ANIMATE_SWAP_START;
    }

    signalSetCover(url) {
        this.url = url;
    }

    animate(time) {
        switch (this.animating) {
            // Move record up out of sight
            case this.ANIMATE_SWAP_START:
                this.target.style.top = `${-50 + (100 / this.DURATION_SWAP) * this.frame}%`;
                this.frame -= time - this.lastTimestamp;
                if (this.frame < 0) {
                    this.animating = this.ANIMATE_SWAP_END;
                    this.frame = this.DURATION_SWAP;
                    if (this.targetUrl == null) {
                        this.target.classList.remove("has-cover");
                        this.target.querySelector(".album-cover").src = "";
                    } else {
                        this.target.querySelector(".album-cover").src = this.targetUrl;
                        this.target.classList.add("has-cover");
                    }
                }
                break;
            // Move record down into frame
            case this.ANIMATE_SWAP_END:
                this.target.style.top = `${50 - (100 / this.DURATION_SWAP) * this.frame}%`;
                this.frame -= time - this.lastTimestamp;
                if (this.frame < 0) {
                    this.target.style.top = "50%";
                    this.animating = this.ANIMATE_IDLE;
                    this.frame = this.DURATION_IDLE;
                }
                break;
            // Spin record to switch tracks
            case this.ANIMATE_SPIN:
                this.rotation = (this.rotation - this.SPEED_WINDING / 1000 * (time - this.lastTimestamp)) % 1;
                this.target.style.transform = `translate(-50%, -50%) rotateZ(${this.rotation}turn)`;
                this.frame -= time - this.lastTimestamp;
                if (this.frame < 0) {
                    this.animating = this.ANIMATE_IDLE;
                    this.frame = this.DURATION_IDLE;
                }
                break;
            // Delay before resuming playback
            case this.ANIMATE_IDLE:
                this.frame -= time - this.lastTimestamp;
                if (this.frame < 0) {
                    this.animating = this.ANIMATE_NONE;
                    this.frame = 0;
                }
                break;
            // Spin while track is playing
            default:
                if (this.playing) {
                    this.rotation = (this.rotation + this.SPEED_PLAYING / 1000 * (time - this.lastTimestamp)) % 1; // 33 1/3 RPM
                    this.target.style.transform = `translate(-50%, -50%) rotateZ(${this.rotation}turn)`;
                }
        }
        // Start playback when animations are completed
        if (this.queued != null && this.animating == this.ANIMATE_NONE) {
            this.playing = true;
            window.setTimeout(this.queued, 0);
            this.queued = null;
        }
        // Next frame
        if (this.glowFrame > 100 || this.playing) {
            this.glowFrame = (this.glowFrame + (time - this.lastTimestamp)) % 1500;
            document.querySelector("#container").style.setProperty("--text-glow-blur", `${4.5 - 2*Math.cos(2 * Math.PI * this.glowFrame / 1500)}px`);
        }
        this.lastTimestamp = time;
        window.requestAnimationFrame(this.animate.bind(this));
    }

    resize() {
        let size = 0.8 * Math.min(
            this.target.parentElement.offsetWidth,
            this.target.parentElement.offsetHeight,
            1000
        );
        this.target.style.width = `${size}px`;
        this.target.style.height = `${size}px`;
    }
}

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
        this.selectedAlbum = -1;
        this.playingAlbum = -1;
        this.playingTrack = -1;
        // State
        this.loader = new AudioLoader(dropZone);
        this.animator = new AudioAnimator(this.audioController);
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
            this.toggleAudio();
        });
        this.player.addEventListener("pause", event => {
            this.pauseAudio();
        });
        this.player.addEventListener("play", event => {
            this.playAudio();
        });
        this.player.addEventListener("ended", event => {
            this.pauseAudio();
            if ("autoplay") {
                if (this.selectedAlbum == this.playingAlbum) {
                    this.selectTrack((this.playingTrack + 1) % this.music[this.selectedAlbum]["tracks"].length);
                } else {
                    this.playingTrack = (this.playingTrack + 1) % this.music[this.selectedAlbum]["tracks"].length;
                    this.player.src = this.music[this.playingAlbum]["tracks"][this.playingTrack]["url"];
                    this.playAudio(true);
                }
            }
        });
        this.animator.resize();
        window.addEventListener("resize", event => {
            this.animator.resize();
        });
        window.requestAnimationFrame(this.animator.animate.bind(this.animator));
    }

    async load(file) {
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
        const formatTime = time => `${Math.floor(time / 60)}:${time < 9.5 ? "0" : ""}${Math.round(time % 60)}`;
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
            this.pauseAudio();
            if (this.selectedAlbum == this.playingAlbum) {
                // Switch tracks
                this.animator.signalRecordSpin(this.music[this.playingAlbum]["tracks"][index]["seek"]);
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
                this.animator.signalRecordSwap(this.music[this.selectedAlbum]["image"]);
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
            if (index != -1) {
                this.player.src = this.music[this.playingAlbum]["tracks"][this.playingTrack]["url"];
            }
            this.playAudio();
        }
    }

    // Control audio

    pauseAudio() {
        this.player.pause();
        this.animator.signalStop();
    }

    playAudio() {
        this.animator.signalStart(() => this.player.play());
    }

    toggleAudio() {
        if (this.animator.isPlaying || this.playingTrack == -1) {
            this.pauseAudio();
        } else {
            this.playAudio();
        }
    }
}

var vinyl = new AudioPlayer(
    document.querySelector("audio#player"),
    document.querySelector("#menu .item-list"),
    document.querySelector("#info .item-list"),
    document.querySelector(".dropzone"),
    document.querySelector("#record")
);