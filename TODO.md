[x] If we play the preview, it stops at the right handle. If we then slide the right handle and press play, it should continue where it left off.
[x] We need a horizontal scrollbar, especially for when we zoom in. (autoScroll enabled; autoCenter removed to prevent scroll-fighting during drag)
[x] It would be nice to be able to move/set the play point manually. a click and drag of a black vertical bar should suffice. (click-to-seek inside region implemented)
[x] Syntax error when I generate full preview. Network error: SyntaxError: JSON.parse: unexpected character at line 1 column 1 of the JSON data
[] Export .m4r also errors out: ffmpeg exited with code 234: Error opening output file /Users/nihar/git/ringtone_maker/tmp/c5869c70-3aa4-4066-bd91-fc8db07745b0.m4r. Error opening output files: Invalid argument
[] The favicon.ico is not loading
[] We should check for already recently downloaded videos as a cache. e.g. if we are downloading to some /tmp/ringtone_maker we should scan it to leverage it as a cache.