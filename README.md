# Fluxim2

Simple Web application to generate AI images. Uses selected Replicate.com models, eg. *FLUX* family of models (requires [Replicate.com](https://replicate.com/) account). Simple authentication (password only).

App written in Node.js (18+), minimal dependencies:

* [express](https://expressjs.com/)

* [dotenv](https://www.npmjs.com/package/dotenv)

## Configuration

All configuration is done through `.env` file with the following variables to be set:

* `PORT` – choose your TCP port

* `REPLICATE_API_TOKEN` – token for Replicate.com account

* `PASSWORDS` – set of available passwords, separated by `PASSWORDS_SEP`

* `PASSWORDS_SEP` – this is separator for passwords

* `PURGE_IMAGES_OLDER_THAN` – all generated images are stored on the server and generally available, this options removes after specified number of hours

**Sample configuration**:

    PORT=3000
    REPLICATE_API_TOKEN=this_is_the_token  
    PASSWORDS=123456|qwerty|abcdef
    PASSWORDS_SEP=|
    PURGE_IMAGES_OLDER_THAN=24
