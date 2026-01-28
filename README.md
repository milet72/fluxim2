# Fluxim2

Simple Web application to generate AI images. Uses selected Replicate.com models, eg. *FLUX* family of models (requires [Replicate.com](https://replicate.com/) account). Simple authentication (password only).

App written in Node.js (18+), minimal dependencies:

* [express](https://expressjs.com/)

* [dotenv](https://www.npmjs.com/package/dotenv)

* [png-metadata-writer](https://www.npmjs.com/package/png-metadata-writer)

## Configuration

All configuration is done through `.env` file with the following variables to be set:

* `DEBUG_MODE` – set to to 1 to enable debugging messages 

* `PORT` – choose your TCP port

* `LOCALE` – locale code for date/time formatting

* `REPLICATE_API_TOKEN` – token for Replicate.com account

* `PASSWORDS` – set of available passwords, separated by `PASSWORDS_SEP`

* `PASSWORDS_SEP` – this is separator for passwords

* `PURGE_IMAGES_OLDER_THAN` – all generated images are stored on the server and generally available, this options removes after specified number of hours

* `LOG_FILE` – path to log file

* `IMG_NAME_PREFIX` – image names are generated semi-randomly, this prefix is added to file name in front of the name

* `PNG_METADATA` - set to 1 to enable writing metadata (eg. prompt) into PNG files

**Sample configuration**:

    DEBUG_MODE=1    
    PORT=3000
    LOCALE=pl_PL
    REPLICATE_API_TOKEN=this_is_the_token  
    PASSWORDS=123456|qwerty|abcdef
    PASSWORDS_SEP=|
    PURGE_IMAGES_OLDER_THAN=24
    LOG_FILE=./fluxim2.log
    IMG_NAME_PREFIX=fluxim2
    PNG_METADATA=1
