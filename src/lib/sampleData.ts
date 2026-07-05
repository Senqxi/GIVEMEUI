import { parseHelpOutput } from "./helpParser";

const SAMPLE_HELP = `usage: python3 [option] ... [-c cmd | -m mod | file | -] [arg] ...
Options and arguments:
-b     : issue warnings about str(bytes_instance), str(bytearray_instance)
-B     : don't write .pyc files on import
-c cmd : program passed in as string
-E     : ignore PYTHON* environment variables
-h     : print this help message and exit
-i     : inspect interactively after running script
-m mod : run library module as a script
-O     : remove assert and __debug__-dependent statements
-q     : don't print version and copyright messages on interactive startup
-s     : don't add user site directory to sys.path
-S     : don't imply 'import site' on initialization
-u     : force the stdout and stderr streams to be unbuffered
-v     : verbose
-V     : print the Python version number and exit
-W arg : warning control; arg is action:message:category:module:lineno
--check-hash-based-pycs always|default|never:
         control how Python invalidates hash-based .pyc files
--help-all : print complete usage information and exit
--version  : print the Python version number and exit`;

export const sampleManifest = parseHelpOutput(SAMPLE_HELP, "python3 --help");

