[x] If we play the preview, it stops at the right handle. If we then slide the right handle and press play, it should continue where it left off.
[x] We need a horizontal scrollbar, especially for when we zoom in. (autoScroll enabled; autoCenter removed to prevent scroll-fighting during drag)
[x] It would be nice to be able to move/set the play point manually. a click and drag of a black vertical bar should suffice. (click-to-seek inside region implemented)
[x] Syntax error when I generate full preview. Network error: SyntaxError: JSON.parse: unexpected character at line 1 column 1 of the JSON data
[x] Export .m4r also errors out: ffmpeg exited with code 234: Error opening output file /Users/nihar/git/ringtone_maker/tmp/c5869c70-3aa4-4066-bd91-fc8db07745b0.m4r. Error opening output files: Invalid argument
[x] The favicon.ico is not loading
[x] Generate full preview fails with 404 "api preview not found": audio element had no error handler; server wasn't handling Range requests for the preview stream (switched to res.sendFile)
[] We should check for already recently downloaded videos as a cache. e.g. if we are downloading to some /tmp/ringtone_maker we should scan it to leverage it as a cache.
[] After loading a youtube video link I see "Invalid URI. Load of media resource  failed." printed in the console
[] I see .wav files in the tmp/ directory. Why are they .wav? I think .m4a would be higher quality? Is .wav required for something?
[] If the left/right handles are edited while playing, the current playback doesn't respect them 
[] we should save the thumbnail with the ringtone file to make it look better.
[] is there a diff between mp4 and m4a?