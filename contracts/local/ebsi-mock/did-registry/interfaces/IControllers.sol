// SPDX-License-Identifier: EUPL V1.2
pragma solidity 0.8.26;

interface IControllers {
    struct Controllers {
        mapping(string => string[]) didsByController;
        mapping(string => mapping(string => uint256)) didsByControllerIndex;
    }
}
