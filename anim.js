const AnimationSettings = {
    // Controller settings
    "NEEDLE_DURATION": 300,
    "RECORD_TURN_SPEED": (100 / 3) / (60 * 1000),
    "RECORD_WIND_SPEED": 45 / (60 * 1000),
    "RECORD_MOVE_DURATION": 600,
    "TEXT_GLOW_PERIOD": 1200,
    // Animation settings
    "NEEDLE_MIN_ANGLE": 11,
    "NEEDLE_MAX_ANGLE": 32,
    "RECORD_HEIGHT": 120,
    "TEXT_MIN_GLOW": 2,
    "TEXT_MAX_GLOW": 8
};

class AudioAnimator {
    constructor(controller) {
        this.currentAlbum = -1;
        this.currentTrack = -1;
        this.targetAlbum = -1;
        this.targetTrack = -1;
        // Animation data
        this.recordRotation = 0;
        this.recordPosition = 0;
        this.needleRotation = 0;
        this.textTimer = 0;
        // Audio playback
        this.controller = controller;
        this.play = false;
    }

    stopAudio() {
        this.play = false;
        this.controller.pauseAudio();
    }

    setTarget(album, track, play) {
        this.targetAlbum = album;
        this.targetTrack = track;
        this.play = play;
    }

    update(delta) {
        if (this.targetAlbum != this.currentAlbum) {
            this.stopSignal();
            this.animateNeedleOff(delta) && this.animateAlbumUp(delta) && this.finishAlbumChange();
        } else if (this.targetTrack != this.currentTrack) {
            this.stopSignal();
            this.animateNeedleOff(delta) && this.animateAlbumDown(delta) &&
                this.animateTrackSpin(delta) && this.finishTrackChange();
        } else if (this.play) {
            this.animateAlbumDown(delta) && this.animateNeedleOn(delta) && this.startSignal();
        } else {
            this.stopSignal();
            this.animateNeedleOff(delta);
        }
        this.animateText(delta);
    }

    animateNeedleOn(delta) {
        this.needleRotation = Math.min(this.needleRotation + delta / AnimationSettings.NEEDLE_DURATION, 1);
        this.controller.setNeedleRotation(this.needleRotation, this.currentTrack);
        this.recordRotation = (this.recordRotation + delta * AnimationSettings.RECORD_TURN_SPEED) % 1;
        this.controller.setRecordRotation(this.recordRotation);
        return this.needleRotation == 1;
    }

    animateNeedleOff(delta) {
        this.needleRotation = Math.max(this.needleRotation - delta / AnimationSettings.NEEDLE_DURATION, 0);
        this.controller.setNeedleRotation(this.needleRotation, this.currentTrack);
        return this.needleRotation == 0; // Return true if completed
    }

    animateAlbumUp(delta) {
        if (this.recordPosition == 0 && delta > 0) {
            this.controller.soundEffectRecordRemove();
        }
        this.recordPosition = Math.min(this.recordPosition + delta / AnimationSettings.RECORD_MOVE_DURATION, 1);
        this.controller.setRecordPosition(this.recordPosition);
        return this.recordPosition == 1;
    }

    animateAlbumDown(delta) {
        let inserted = this.recordPosition == 0;
        this.recordPosition = Math.max(this.recordPosition - delta / AnimationSettings.RECORD_MOVE_DURATION, 0);
        this.controller.setRecordPosition(this.recordPosition);
        if (!inserted && this.recordPosition == 0 && delta > 0) {
            this.controller.soundEffectRecordInsert();
        }
        return this.recordPosition == 0;
    }

    animateTrackSpin(delta) {
        let targetRotation = this.controller.getTrackPosition(this.targetAlbum, this.targetTrack);
        const difference = () => (targetRotation - this.recordRotation + 1.5) % 1 - 0.5;
        let reached = false;
        if (difference() > 0) {
            this.recordRotation = (this.recordRotation + delta * AnimationSettings.RECORD_WIND_SPEED) % 1;
            if (difference() <= 0) {
                this.recordRotation = targetRotation;
                reached = true;
            }
        } else {
            this.recordRotation = (this.recordRotation - delta * AnimationSettings.RECORD_WIND_SPEED) % 1;
            if (difference() >= 0) {
                this.recordRotation = targetRotation;
                reached = true;
            }
        }
        this.controller.setRecordRotation(this.recordRotation);
        return reached;
    }

    animateText(delta) {
        if (this.currentAlbum == this.targetAlbum && this.currentTrack == this.targetTrack && this.play) {
            this.textTimer = (this.textTimer + delta / AnimationSettings.TEXT_GLOW_PERIOD) % 1;
        } else {
            if (this.textTimer > 0 && this.textTimer < 0.5) {
                this.textTimer = 1 - this.textTimer;
            }
            if (this.textTimer != 0) {
                let nextTimer = (this.textTimer + delta / AnimationSettings.TEXT_GLOW_PERIOD) % 1;
                this.textTimer = (nextTimer > this.textTimer) ? nextTimer : 0;
            }
        }
        this.controller.setTextGlow(this.textTimer);
    }

    finishAlbumChange() {
        this.currentAlbum = this.targetAlbum;
        this.controller.setAlbumCover(this.currentAlbum);
        this.recordRotation = 0;
        this.controller.setRecordRotation(this.recordRotation);
    }

    finishTrackChange() {
        this.currentTrack = this.targetTrack;
    }

    startSignal() {
        this.controller.playAudio(this.currentAlbum, this.currentTrack);
    }

    stopSignal() {
        this.controller.pauseAudio();
    }
}

class AudioAnimationController {
    constructor(recordElement, needleElement, audioElement, retrieveMetadata) {
        this.recordElement = recordElement;
        this.needleElement = needleElement;
        this.audioElement = audioElement;
        // Sfx
        this.recordRunningSound = new Audio("res/record_static.mp3");
        this.recordRunningSound.loop = true;
        this.recordRunningSound.volume = 0.16;
        this.recordRemoveSound = new Audio("res/record_remove.mp3");
        this.recordRemoveSound.volume = 0.4;
        this.recordInsertSound = new Audio("res/record_insert.mp3");
        this.recordInsertSound.volume = 0.4;
        // Back reference
        this.retrieveMetadata = retrieveMetadata;
    }

    resize() {
        let size = 0.8 * Math.min(
            this.recordElement.parentElement.offsetWidth,
            this.recordElement.parentElement.offsetHeight,
            1000
        );
        this.recordElement.style.width = `${size}px`;
        this.recordElement.style.height = `${size}px`;
        this.needleElement.style.width = `${3/16 * size}px`;
        this.needleElement.style.height = `${3/4 * size}px`;
        this.needleElement.style.left = `calc(50% + ${0.55 * size}px)`;
        this.needleElement.style.top = `calc(50% - ${0.55 * size}px)`;
    }

    getTrackPosition(i, j) {
        return this.retrieveMetadata()[i]["tracks"][j]["seek"] % (1 / (1000 * AnimationSettings.RECORD_TURN_SPEED));
    }

    setNeedleRotation(x, j) {
        const fullRotation = AnimationSettings.NEEDLE_MIN_ANGLE +
            (AnimationSettings.NEEDLE_MAX_ANGLE - AnimationSettings.NEEDLE_MIN_ANGLE) / (1 + Math.exp(-0.75 * j + 3));
        x = Math.min(1.25 * x, 1);
        this.needleElement.style.transform = `translate(-50%, -7.12%) rotateZ(${fullRotation * x}deg)`;
    }

    setRecordRotation(x) {
        this.recordElement.style.transform = `translate(-50%, -50%) rotateZ(${x}turn)`;
    }

    setRecordPosition(x) {
        x = Math.pow(x, 1.5);
        this.recordElement.style.top = `${50 - AnimationSettings.RECORD_HEIGHT * x}%`;
    }

    setAlbumCover(i) {
        let image = this.retrieveMetadata()[i]["image"];
        if (image) {
            this.recordElement.querySelector(".album-cover").src = image;
            this.recordElement.classList.add("has-cover");
        } else {
            this.recordElement.classList.remove("has-cover");
            this.recordElement.querySelector(".album-cover").src = "";
        }
    }

    setTextGlow(x) {
        document.querySelector("#container").style.setProperty(
            "--text-glow-blur",
            `${AnimationSettings.TEXT_MAX_GLOW - 0.5 * (AnimationSettings.TEXT_MAX_GLOW-AnimationSettings.TEXT_MIN_GLOW) * Math.cos(2 * Math.PI * x)}px`
        );
    }

    soundEffectRecordRemove() {
        if (this.recordRemoveSound.paused) {
            this.recordRemoveSound.play();
        }
    }

    soundEffectRecordInsert() {
        if (this.recordInsertSound.paused) {
            this.recordInsertSound.play();
        }
    }

    playAudio(i, j) {
        // SFX
        if (this.recordRunningSound.paused) {
            this.recordRunningSound.play();
        }
        // Actual audio
        let targetSrc = this.retrieveMetadata()[i]["tracks"][j]["url"]
        if (this.audioElement.src != targetSrc) {
            this.audioElement.src = targetSrc;
        }
        if (this.audioElement.paused) {
            this.audioElement.play();
        }
    }

    pauseAudio() {
        // SFX
        if (!this.recordRunningSound.paused) {
            this.recordRunningSound.pause();
        }
        // Actual audio
        this.audioElement.pause();
    }
}