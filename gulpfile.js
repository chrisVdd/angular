var gulp = require('gulp');
var rename = require('gulp-rename');
var watch = require('gulp-watch');
var shell = require('gulp-shell');
var mergeStreams = require('event-stream').merge;
var connect = require('gulp-connect');
var clean = require('gulp-rimraf');
var runSequence = require('run-sequence');
var glob = require('glob');
var ejs = require('gulp-ejs');
var path = require('path');
var through2 = require('through2');

// import js2dart build tasks
var js2dartTasks = require('./tools/js2dart/gulp-tasks');
js2dartTasks.install(gulp);

var js2es5Options = {
  annotations: true, // parse annotations
  types: true, // parse types
  script: false, // parse as a module
  modules: 'register',
  typeAssertionModule: 'assert',
  typeAssertions: true,
  moduleName: true
};

var js2dartOptions = {
  annotations: true, // parse annotations
  types: true, // parse types
  script: false, // parse as a module
  outputLanguage: 'dart',
  moduleName: true
};

var traceur = require('./tools/js2dart/gulp-traceur');

// ---------
// rtts-assert and traceur runtime

gulp.task('jsRuntime/build', function() {
  return createJsRuntimeTask(false);
});

function createJsRuntimeTask(isWatch) {
  var srcFn = isWatch ? watch : gulp.src.bind(gulp);
  var rttsAssert = srcFn('tools/rtts-assert/src/assert.js')
    .pipe(traceur(js2es5Options))
    .pipe(gulp.dest('build/js'));
  var traceurRuntime = srcFn('tools/js2dart/node_modules/traceur/bin/traceur-runtime.js')
    .pipe(gulp.dest('build/js'));
  return mergeStreams(rttsAssert, traceurRuntime);
}

// -----------------------
// modules
var sourceTypeConfigs = {
  dart: {
    compiler: function() {
      return traceur(js2dartOptions, true);
    },
    transpileSrc: ['modules/**/*.js'],
    htmlSrc: ['modules/*/src/**/*.html'],
    copySrc: ['modules/**/*.dart', 'modules/**/*.yaml'],
    outputDir: 'build/dart',
    outputExt: 'dart',
    mimeType: 'application/dart',
    postProcess: function(file, done) {
      if (file.path.match(/pubspec\.yaml/)) {
        console.log(file.path);
        shell.task(['pub get'], {
          cwd: path.dirname(file.path)
        })().on('end', done);
      } else {
        done();
      }
    }
  },
  js: {
    compiler: function() {
      return traceur(js2es5Options, true);
    },
    transpileSrc: ['modules/**/*.js', 'modules/**/*.es6'],
    htmlSrc: ['modules/*/src/**/*.html'],
    copySrc: ['modules/**/*.es5'],
    outputDir: 'build/js',
    outputExt: 'js',
    postProcess: function() {

    }
  }
};


gulp.task('modules/clean', function() {
  return gulp.src('build', {read: false})
      .pipe(clean());
});

gulp.task('modules/build.dart/src', function() {
  return createModuleTask(sourceTypeConfigs.dart, false);
});

gulp.task('modules/build.dart/analyzer', function() {
  var baseDir = sourceTypeConfigs.dart.outputDir;
  var files = [].slice.call(glob.sync('*/lib/*.dart', {
    cwd: baseDir
  }));
  files = files.filter(function(fileName) {
    return fileName.match(/(\w+)\/lib\/\1/);
  });
  var commands = files.map(function(fileName) {
    return 'dartanalyzer '+baseDir+'/'+fileName
  });
  return shell.task(commands)();
});

gulp.task('modules/build.dart', function(done) {
  runSequence('modules/build.dart/src', 'modules/build.dart/analyzer', done);
});

gulp.task('modules/build.js', function() {
  return createModuleTask(sourceTypeConfigs.js, false);
});

function renameSrcToLib(file) {
  file.dirname = file.dirname.replace(/\bsrc\b/, 'lib');
}

function createModuleTask(sourceTypeConfig, isWatch) {
  var start = isWatch ? watch : gulp.src.bind(gulp);
  var transpile = start(sourceTypeConfig.transpileSrc)
    .pipe(rename({extname: '.'+sourceTypeConfig.outputExt}))
    .pipe(rename(renameSrcToLib))
    .pipe(sourceTypeConfig.compiler())
    .pipe(gulp.dest(sourceTypeConfig.outputDir));
  var copy = start(sourceTypeConfig.copySrc)
    .pipe(rename(renameSrcToLib))
    .pipe(gulp.dest(sourceTypeConfig.outputDir));
  // TODO: provide the list of files to the template
  // automatically!
  var html = start(sourceTypeConfig.htmlSrc)
    .pipe(rename(renameSrcToLib))
    .pipe(ejs({
      type: sourceTypeConfig.outputExt
    }))
    .pipe(gulp.dest(sourceTypeConfig.outputDir));

  var s = mergeStreams(transpile, copy, html);
  return s.pipe(through2.obj(function(file, enc, done) {
    sourceTypeConfig.postProcess(file, done);
  }));
}

// ------------------
// WEB SERVER
gulp.task('serve', connect.server({
  root: [__dirname+'/build'],
  port: 8000,
  livereload: false,
  open: false,
  middleware: function() {
    return [function(req, resp, next){
      if (req.url.match(/\.dart$/)) {
        resp.setHeader("Content-Type", "application/dart");
      }
      next();
    }];
  }
}));

// --------------
// general targets

gulp.task('clean', ['js2dart/clean', 'modules/clean']);

gulp.task('build', function() {
  return runSequence(
    // sequential
    'js2dart/build',
    // parallel
    ['jsRuntime/build', 'modules/build.dart', 'modules/build.js']
  );
});

gulp.task('watch', function() {
  runSequence('js2dart/test/watch');
  var js2dartWatch = watch(js2dartTasks.paths.js2dartSrc, function(_, done) {
    runSequence(
      // sequential
      'js2dart/build', 'js2dart/test',
      // parallel
      ['jsRuntime/build', 'modules/build.dart', 'modules/build.js'],
      done);
  });
  var dartModuleWatch = createModuleTask(sourceTypeConfigs.dart, true);
  var jsModuleWatch = createModuleTask(sourceTypeConfigs.js, true);
  return mergeStreams(js2dartWatch, dartModuleWatch, jsModuleWatch, createJsRuntimeTask(true));
});